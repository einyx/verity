import pptxgenModule from 'pptxgenjs';

import { brand, wordmarkPngBase64 } from './landing-page-brand.js';
import { type BriefInput } from './landing-page-brief.js';
import { buildExportContent } from './landing-page-export-content.js';
import { wrapSlideText } from './landing-page-slide-layout.js';

type Slide = {
  background: { color: string };
  addText: (text: string, options: Record<string, unknown>) => void;
  addImage: (options: Record<string, unknown>) => void;
  addShape: (shape: string, options: Record<string, unknown>) => void;
};
type Deck = {
  layout: string;
  title: string;
  company: string;
  subject: string;
  theme: { headFontFace: string; bodyFontFace: string; lang: string };
  addSlide: () => Slide;
  write: (options: { outputType: 'nodebuffer' }) => Promise<unknown>;
};
// eslint-disable-next-line no-restricted-syntax -- The package's CommonJS default is a constructor, unlike its ESM declarations.
const PptxGenJS = pptxgenModule as unknown as new () => Deck;
const fontFace = 'Arial';

type TextBox = {
  name: string;
  top: number;
  height: number;
  left?: number;
  width?: number;
  size?: number;
  color?: string;
  bold?: boolean;
  link?: string;
};
const text = (slide: Slide, value: string, box: TextBox) => {
  slide.addText(value, {
    objectName: box.name,
    x: box.left ?? 0.7,
    y: box.top,
    w: box.width ?? 11.8,
    h: box.height,
    fontFace,
    fontSize: box.size ?? 18,
    color: box.color ?? brand.ink,
    bold: box.bold ?? false,
    margin: 0,
    valign: 'top',
    isTextBox: true,
    lineSpacingMultiple: 1.12,
    ...(box.link ? { hyperlink: { url: box.link } } : {}),
  });
};

/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- pptxgenjs writes only a new document; page and reference cursors are local. */
/** Editable prospect deck. Only the explicit prospect projection enters text or metadata. */
// eslint-disable-next-line @typescript-eslint/ban-types -- Existing Koa callers require the backward-compatible Buffer return contract.
export const buildSlidesDeck = async (input: BriefInput, date: string): Promise<Buffer> => {
  const content = buildExportContent(input).prospect;
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.title = 'meshX discovery conversation';
  deck.company = 'meshX';
  deck.subject = 'Prospect discussion - proposed agenda';
  deck.theme = { headFontFace: fontFace, bodyFontFace: fontFace, lang: 'en-US' };
  let page = 0;
  const frame = (title?: string, dark = false) => {
    const slide = deck.addSlide();
    page += 1;
    slide.background = { color: dark ? brand.ink : brand.surface };
    const color = dark ? brand.surface : brand.ink;
    if (title) {
      text(slide, title, {
        name: 'section-title',
        top: 0.65,
        height: 0.7,
        size: 30,
        bold: true,
        color,
      });
    }
    text(
      slide,
      `${content.synthetic ? 'DEMO DATA  |  ' : ''}meshX  /  Discovery discussion  /  ${date}`,
      {
        name: 'footer-context',
        top: 6.75,
        height: 0.24,
        width: 10.8,
        size: 10,
        color: dark ? brand.surface : brand.muted,
      }
    );
    text(slide, String(page).padStart(2, '0'), {
      name: 'footer-page',
      left: 12,
      top: 6.75,
      width: 0.6,
      height: 0.24,
      size: 10,
      color,
    });
    return slide;
  };

  const companyLines = wrapSlideText(content.company, 11.8, 44);
  for (let offset = 0; offset < companyLines.length; offset += 3) {
    const slide = frame();
    slide.addImage({
      data: `image/png;base64,${wordmarkPngBase64}`,
      x: 0.7,
      y: 0.7,
      w: 2.2,
      h: 0.4,
    });
    text(slide, offset ? 'DISCOVERY DISCUSSION / COMPANY CONTINUED' : 'DISCOVERY DISCUSSION', {
      name: 'cover-label',
      top: 1.5,
      height: 0.4,
      size: 16,
      color: brand.accent,
      bold: true,
    });
    text(slide, companyLines.slice(offset, offset + 3).join('\n'), {
      name: 'company-title',
      top: 2.2,
      height: 2.7,
      size: 44,
      bold: true,
    });
    text(slide, content.synthetic ? 'DEMO DATA' : 'Prepared for discussion', {
      name: 'cover-status',
      top: 5.55,
      height: 0.45,
      size: 18,
      color: brand.accent,
      bold: true,
    });
  }

  const contentSlides = (title: string, value: string, label: string, dark = false) => {
    const lines = wrapSlideText(value, 11.8, 22);
    for (let offset = 0; offset < lines.length; offset += 9) {
      const slide = frame(`${title}${offset ? ' / continued' : ''}`, dark);
      const color = dark ? brand.surface : brand.ink;
      text(slide, label, {
        name: 'evidence-label',
        top: 1.55,
        height: 0.55,
        size: 14,
        color: dark ? brand.surface : brand.muted,
      });
      text(slide, lines.slice(offset, offset + 9).join('\n'), {
        name: 'content-body',
        top: 2.3,
        height: 3.85,
        size: 22,
        color,
      });
    }
  };
  contentSlides(
    'Stated objective',
    content.objective,
    'Visitor-provided objective - scope to confirm',
    true
  );
  contentSlides(
    'Company research',
    content.summary,
    `AI-assisted public website research | Research date: ${content.researchDate}`
  );

  const agenda = frame('Proposed agenda - not yet agreed');
  for (const [index, question] of content.questions.entries()) {
    const top = 2.05 + index * 1.45;
    agenda.addShape('ellipse', {
      x: 0.7,
      y: top,
      w: 0.6,
      h: 0.6,
      fill: { color: brand.accent },
      line: { color: brand.accent },
    });
    text(agenda, String(index + 1), {
      name: `agenda-number-${index + 1}`,
      left: 0.9,
      top: top + 0.13,
      width: 0.3,
      height: 0.35,
      size: 18,
      color: brand.surface,
      bold: true,
    });
    text(agenda, wrapSlideText(question, 10.4, 20).join('\n'), {
      name: `agenda-question-${index + 1}`,
      left: 1.8,
      top,
      width: 10.4,
      height: 1.05,
      size: 20,
    });
  }

  // Group up to five references per appendix slide; oversized URLs flow onto continuation pages.
  const addReferences = () => {
    const sources = content.sources.length > 0 ? content.sources : ['Source links: not available'];
    let references: Slide | undefined;
    let top = 0;
    let count = 0;
    for (const [index, source] of sources.entries()) {
      const lines = wrapSlideText(source, 11.8, 14);
      for (let offset = 0; offset < lines.length; offset += 12) {
        const chunk = lines.slice(offset, offset + 12);
        const height = (chunk.length * 14 * 1.12) / 72 + 0.08;
        const required = 0.32 + height + 0.18;
        if (!references || count >= 5 || top + required > 6.4) {
          references = frame('Research references');
          text(
            references,
            `AI-assisted public website research | Research date: ${content.researchDate}`,
            { name: 'references-label', top: 1.55, height: 0.55, size: 14, color: brand.muted }
          );
          top = 2.25;
          count = 0;
        }
        text(references, `Source ${index + 1}${offset ? ' / continued' : ''}`, {
          name: `citation-label-${index + 1}`,
          top,
          height: 0.3,
          size: 14,
          bold: true,
        });
        text(references, chunk.join('\n'), {
          name: `citation-url-${index + 1}`,
          top: top + 0.32,
          height,
          size: 14,
          color: brand.accent,
          link: content.sources[index],
        });
        top += required;
        count += 1;
      }
    }
  };
  addReferences();
  const output = await deck.write({ outputType: 'nodebuffer' });
  if (!Buffer.isBuffer(output)) {
    throw new TypeError('Expected PPTX nodebuffer output');
  }
  return output;
};
/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */
