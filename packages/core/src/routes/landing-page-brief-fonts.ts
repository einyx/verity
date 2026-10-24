import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fontkit, { type Font, type GlyphRun } from '@pdf-lib/fontkit';
import { findUpSync } from 'find-up';
import {
  type PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type Color,
} from 'pdf-lib';

import bidiFactory from '../assets/brief-fonts/bidi.mjs';

/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods -- Font runs and PDF operators are local per-render accumulators; cached bytes are never modified. */

const names = [
  'NotoSans-Regular.ttf',
  'NotoSans-Bold.ttf',
  'NotoSansArabic-Regular.ttf',
  'NotoSansThai-Regular.ttf',
  'NotoSansCJKsc-Regular.otf',
] as const;

// A route emitted by tsc, a tsup index or a nested worker entry resolves the same ancestor assets.
// No source-tree fallback: a broken deployment fails rather than relying on development files.
const assetManifest = findUpSync('assets/brief-fonts/provenance.json', {
  cwd: path.dirname(fileURLToPath(import.meta.url)),
});
let bytesPromise: Promise<Uint8Array[]> | undefined;
const fontBytes = async () => {
  if (!assetManifest) {
    throw new Error('Bundled PDF fonts are missing; run pnpm copy:apidocs before starting core');
  }
  bytesPromise ??= Promise.all(
    names.map(async (name) => readFile(`${path.dirname(assetManifest)}/${name}`))
  );
  return bytesPromise;
};

type Face = { font: Font; pdf: PDFFont | undefined };
type Run = { text: string; face: Face; layout: GlyphRun };

const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const arabic = /\p{Script=Arabic}/u;
const thai = /\p{Script=Thai}/u;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const bidiControls = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const bidi = bidiFactory();
const features = { liga: false, clig: false };
const direction = (text: string): 'ltr' | 'rtl' =>
  (bidi.getEmbeddingLevels(text).paragraphs[0]?.level ?? 0) % 2 ? 'rtl' : 'ltr';

const preferredFaceIndex = (segment: string, strong: boolean) =>
  arabic.test(segment) ? 2 : thai.test(segment) ? 3 : cjk.test(segment) ? 4 : strong ? 1 : 0;

// Fontkit's runtime accepts direction, but its published declaration omits the last arguments.
type DirectionalLayout = (
  text: string,
  layoutFeatures: typeof features,
  script: undefined,
  language: undefined,
  direction: 'ltr' | 'rtl'
) => GlyphRun;

const unsupported = (text: string) => {
  const codepoints = Array.from(
    text,
    (character) => `U+${character.codePointAt(0)?.toString(16).toUpperCase()}`
  ).join(' ');
  return new Error(`Unsupported PDF text (${codepoints}); original text is in brief-text.txt`);
};

/** Per-document fonts; only immutable source bytes are shared between requests. */
export const loadBriefFonts = async (document: PDFDocument, text = '字') => {
  document.registerFontkit(fontkit);
  const bytes = await fontBytes();
  const parsed = bytes.map((data) => fontkit.create(data));
  const needsCjk = Array.from(new Set(text)).some((character) => {
    const codepoint = character.codePointAt(0) ?? 0;
    return (
      parsed[4]?.hasGlyphForCodePoint(codepoint) &&
      !parsed.slice(0, 4).some((font) => font.hasGlyphForCodePoint(codepoint))
    );
  });
  const faces = await Promise.all(
    bytes.map(async (data, index) => {
      const font = parsed[index];
      if (!font) {
        throw new Error('Incomplete bundled PDF font set');
      }
      if (index === 4 && !needsCjk) {
        return { font, pdf: undefined };
      }
      // Fontkit's CID-keyed CFF subset is unreadable by FreeType/MuPDF. Embed the original CJK
      // font only when needed; never emit a broken subset or depend on viewer/system fallback.
      const pdf = await document.embedFont(data, { subset: index !== 4, features });
      // Fontkit cannot serialize an empty CFF subset. Seed a space, also for unused fallbacks.
      pdf.encodeText(' ');
      return { font, pdf };
    })
  );
  const [regular, bold] = faces;
  if (!regular || !bold) {
    throw new Error('Incomplete bundled PDF font set');
  }

  const runs = (text: string, strong = false, baseDirection = direction(text)): Run[] => {
    const levels = bidi.getEmbeddingLevels(text, baseDirection);
    const mirrored = bidi.getMirroredCharactersMap(text, levels);
    const order = Array.from({ length: text.length }, (_, index) => index);
    for (const [start, end] of bidi.getReorderSegments(text, levels)) {
      order.splice(start, end - start + 1, ...order.slice(start, end + 1).reverse());
    }
    const visualIndices = new Map(order.map((logical, visual) => [logical, visual]));
    const result: Array<{ text: string; face: Face; level: number; visual: number }> = [];
    for (const { segment, index } of graphemes.segment(text)) {
      if (bidiControls.test(segment)) {
        throw unsupported(segment);
      }
      const supports = (candidate: Face) =>
        Array.from(segment).every(
          (character) =>
            ['\u200C', '\u200D'].includes(character) ||
            candidate.font.hasGlyphForCodePoint(character.codePointAt(0) ?? 0)
        );
      const preferred = faces[preferredFaceIndex(segment, strong)];
      const previous = result.at(-1);
      const face =
        preferred && supports(preferred)
          ? preferred
          : faces.find((candidate) => supports(candidate));
      if (!face) {
        throw unsupported(segment);
      }
      const level = levels.levels[index] ?? 0;
      const value = Array.from(
        segment,
        (character, offset) => mirrored.get(index + offset) ?? character
      ).join('');
      const visual = visualIndices.get(index) ?? index;
      if (previous?.face === face && previous.level === level) {
        previous.text += value;
        previous.visual = Math.min(previous.visual, visual);
      } else {
        result.push({ text: value, face, level, visual });
      }
    }
    return result
      .sort((first, second) => first.visual - second.visual)
      .map(({ text: value, face, level }) => {
        // eslint-disable-next-line no-restricted-syntax -- Fontkit supports these direction arguments at runtime, but its published type omits them.
        const layout = (face.font.layout as DirectionalLayout)(
          value,
          features,
          undefined,
          undefined,
          level % 2 ? 'rtl' : 'ltr'
        );
        if (layout.glyphs.some(({ id }) => id === 0)) {
          throw unsupported(value);
        }
        return { text: value, face, layout };
      });
  };
  const width = (text: string, size: number, strong = false, baseDirection = direction(text)) =>
    runs(text, strong, baseDirection).reduce(
      (sum, { face, layout }) => sum + (layout.advanceWidth * size) / face.font.unitsPerEm,
      0
    );

  const draw = (
    page: PDFPage,
    text: string,
    options: {
      x: number;
      y: number;
      size: number;
      color: Color;
      strong?: boolean;
      direction?: 'ltr' | 'rtl';
    }
  ) => {
    const {
      x: positionX,
      y: positionY,
      size,
      color,
      strong = false,
      direction: baseDirection = direction(text),
    } = options;
    // ActualText preserves logical Unicode (including ligatures and RTL) independently of glyph order.
    page.pushOperators(
      pushGraphicsState(),
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
        PDFName.of('Span'),
        document.context.obj({ ActualText: PDFHexString.fromText(text) }).toString(),
      ]),
      beginText(),
      setFillingColor(color)
    );
    let cursor = positionX;
    for (const { text: value, face, layout } of runs(text, strong, baseDirection)) {
      if (!face.pdf) {
        throw new Error('PDF font was not preloaded for this text');
      }
      const fontName = page.node.newFontDictionary(face.pdf.name, face.pdf.ref);
      const encoded = face.pdf.encodeText(value).asString();
      const defaultLayout = face.font.layout(value, features);
      const glyphCodes = new Map(
        defaultLayout.glyphs.map(({ id }, index) => [id, encoded.slice(index * 4, index * 4 + 4)])
      );
      const scale = size / face.font.unitsPerEm;
      page.pushOperators(setFontAndSize(fontName, size));
      for (const [index, position] of layout.positions.entries()) {
        const glyph = layout.glyphs[index];
        const code = glyph && glyphCodes.get(glyph.id);
        if (!code) {
          throw new Error('Fontkit directional glyph mismatch; refusing to emit corrupt PDF text');
        }
        // Pdf-lib drawText drops GPOS offsets; explicitly apply shaping advances AND mark offsets.
        page.pushOperators(
          setTextMatrix(
            1,
            0,
            0,
            1,
            cursor + position.xOffset * scale,
            positionY + position.yOffset * scale
          ),
          showText(PDFHexString.of(code))
        );
        cursor += position.xAdvance * scale;
      }
    }
    page.pushOperators(
      endText(),
      PDFOperator.of(PDFOperatorNames.EndMarkedContent),
      popGraphicsState()
    );
  };

  return { runs, width, draw, direction };
};

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods */
