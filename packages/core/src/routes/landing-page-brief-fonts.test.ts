import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { loadBriefFonts } from './landing-page-brief-fonts.js';
import { renderBriefPdf } from './landing-page-brief.js';

const multilingual = 'José Müller Привет مرحبا بالعالم سلام فارسی ภาษาไทย 東京 中文 한국어';

describe('bundled brief fonts', () => {
  it('copies the exact licensed assets beside emitted routes', async () => {
    const root = new URL('../assets/brief-fonts/', import.meta.url);
    const source = new URL('../../src/assets/brief-fonts/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8')) as Array<{
      file: string;
      bytes: number;
      sha256: string;
    }>;
    await Promise.all(
      manifest.map(async (entry) => {
        const [bytes, original] = await Promise.all([
          readFile(new URL(entry.file, root)),
          readFile(new URL(entry.file, source)),
        ]);
        expect(bytes.length).toBe(entry.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
        expect(bytes.equals(original)).toBe(true);
      })
    );
  });

  it('loads local assets and shapes every supported script without missing glyphs', async () => {
    const fonts = await loadBriefFonts(await PDFDocument.create());
    const runs = fonts.runs(multilingual);
    expect(runs.flatMap(({ layout }) => layout.glyphs).every(({ id }) => id !== 0)).toBe(true);
    expect(runs.some(({ layout }) => layout.direction === 'rtl')).toBe(true);
    expect(fonts.width(multilingual, 11)).toBeGreaterThan(0);
    expect(
      fonts
        .runs('น้ำขึ้น')
        .some(({ layout }) =>
          layout.positions.some(({ xOffset, yOffset }) => xOffset !== 0 || yOffset !== 0)
        )
    ).toBe(true);
  });

  it('keeps logical Unicode and embedded subsets in actual PDF bytes', async () => {
    const pdf = await PDFDocument.load(
      await renderBriefPdf({
        lead: {
          firstName: 'José',
          lastName: 'Müller',
          company: '東京 中文 한국어',
          email: 'unicode@example.invalid',
        },
        exportContext: { notes: multilingual + '\nEND_OF_MULTILINE_NOTES' },
      })
    );
    const streams = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream
          ? [Buffer.from(decodePDFRawStream(object).decode()).toString('latin1')]
          : []
      )
      .join('\n');
    expect(streams).toContain('/ActualText');
    expect(streams).toContain('beginbfchar');
    expect(streams).not.toContain('/Helvetica');
    const text = Array.from(streams.matchAll(/\/ActualText\s*<([\dA-Fa-f]+)>/g), ([, hex]) =>
      Buffer.from(hex ?? '', 'hex')
        .swap16()
        .toString('utf16le')
        .replace(/^\uFEFF/, '')
    ).join(' ');
    expect(text).toContain(multilingual);
    expect(text).toContain('END_OF_MULTILINE_NOTES');
    expect(text).not.toContain('Unsupported');
  }, 60_000);

  it('explicitly reports unsupported glyphs, never silently replaces them', async () => {
    const fonts = await loadBriefFonts(await PDFDocument.create());
    expect(() => fonts.runs('🦄')).toThrow('U+1F984');
    expect(() => fonts.runs('abc\u202Edef')).toThrow('U+202E');
  });

  it('orders RTL words around LTR numbers while preserving numeric order', async () => {
    const fonts = await loadBriefFonts(await PDFDocument.create());
    const runs = fonts.runs('مرحبا 123 بالعالم');
    expect(runs.map(({ text }) => text).join('')).toBe('بالعالم 123 مرحبا');
    expect(runs.find(({ text }) => text === '123')?.layout.direction).toBe('ltr');
    expect(fonts.direction('مرحبا 123')).toBe('rtl');
    expect(fonts.direction('Notes: مرحبا 123')).toBe('ltr');
  });

  it('includes unsupported original text in the UTF-8 attachment with a visible warning', async () => {
    const original = 'Original unsupported 🦄 text';
    const pdf = await PDFDocument.load(
      await renderBriefPdf({
        lead: {
          firstName: 'José',
          lastName: 'Müller',
          company: 'Example',
          email: 'unicode@example.invalid',
        },
        exportContext: { notes: original },
      })
    );
    const streams = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream ? [Buffer.from(decodePDFRawStream(object).decode())] : []
      );
    expect(streams.some((bytes) => bytes.toString('utf8').includes(original))).toBe(true);
    const text = streams
      .flatMap((bytes) =>
        Array.from(
          bytes.toString('latin1').matchAll(/\/ActualText\s*<([\dA-Fa-f]+)>/g),
          ([, hex]) =>
            Buffer.from(hex ?? '', 'hex')
              .swap16()
              .toString('utf16le')
        )
      )
      .join(' ');
    expect(text).toContain('Unsupported PDF text (U+1F984)');
    expect(text).toContain('brief-text.txt');
  }, 60_000);
});
