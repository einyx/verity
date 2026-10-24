import { PDFDocument, PDFName, type PDFPage, PDFString, rgb } from 'pdf-lib';

import { wordmarkPngBase64 } from './landing-page-brand.js';
import { loadBriefFonts } from './landing-page-brief-fonts.js';
import { buildExportContent, exportLink } from './landing-page-export-content.js';

// Internal meeting brief, rendered locally with embedded fonts and no browser or runtime downloads.

export type BriefInput = {
  lead: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    role?: string;
    industry?: string;
    interests?: string[];
    decision?: string;
    contactMethod?: string;
    contactDetail?: string;
  };
  profile?: {
    summary?: string;
    domain?: string;
    sources?: string[];
    generatedAt?: string;
    syntheticContact?: boolean;
    researchStatus?: string;
    /** Optional budget advisory. It stays unknown here and is validated where it is rendered. */
    budgetAssessment?: unknown;
    conversation?: { tone?: string; outcomes?: string[]; nextSteps?: string[] };
  };
  bookingUrl?: string | undefined;
  exportContext?: {
    notes?: string;
    status?: string;
    tags?: string[];
    transcript?: unknown;
  };
};

/** The visitor's LinkedIn profile, when they chose LinkedIn and gave an https link on linkedin.com. */
export const linkedinProfile = (lead: BriefInput['lead']): string | undefined => {
  if (lead.contactMethod !== 'linkedin' || !lead.contactDetail) {
    return undefined;
  }

  try {
    const url = new URL(lead.contactDetail);
    const onLinkedin = url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com');

    return url.protocol === 'https:' && onLinkedin ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** The brief as a standalone HTML page. Every value from the lead or the model is escaped. */
export const buildBriefHtml = (input: BriefInput): string => {
  const content = buildExportContent(input).internal;
  const booking = exportLink(input.bookingUrl);
  const linkedin = linkedinProfile(input.lead);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Internal meeting brief</title>
<style>@page{size:A4;margin:18mm}body{background:white;color:#0E0E0E;font:11pt 'Stack Sans Text',Arial,sans-serif;line-height:1.5}h1,h2{font-family:'Stack Sans Headline',Arial,sans-serif}h1{font-size:26pt}h2{font-size:12pt;color:#FE330A;break-after:avoid}p{overflow-wrap:anywhere}section{margin:24px 0}footer{font-size:10pt;color:#63625F}</style></head><body>
<img alt="meshX" width="160" src="data:image/png;base64,${wordmarkPngBase64}">
<p>Confidential / Internal sales brief${content.synthetic ? ' / DEMO DATA' : ''}</p>
<h1>${escapeHtml(content.company)}</h1>
${content.sections.map(({ title, lines }) => `<section><h2>${escapeHtml(title)}</h2>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</section>`).join('')}
${linkedin ? `<p>LinkedIn: <a href="${escapeHtml(linkedin)}">${escapeHtml(linkedin)}</a></p>` : ''}
${booking ? `<p>Book the next meeting: <a href="${escapeHtml(booking)}">${escapeHtml(booking)}</a></p>` : ''}
<footer>Confidential / Internal only${content.synthetic ? ' / DEMO DATA' : ''} - meshX</footer></body></html>`;
};

/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods -- pdf-lib uses an imperative writer; accumulators only mutate this newly created document, not inputs. */

const pageSize: [number, number] = [595.28, 841.89];
const margin = 52;
const contentWidth = pageSize[0] - margin * 2;
const accent = rgb(0.996, 0.2, 0.039); // FE330A, the deck accent
const ink = rgb(0.055, 0.055, 0.055); // 0E0E0E
const muted = rgb(0.388, 0.384, 0.373); // 63625F

type Writer = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  fonts: Awaited<ReturnType<typeof loadBriefFonts>>;
  synthetic: boolean;
};

const newPage = (writer: Writer) => {
  writer.page = writer.doc.addPage(pageSize);
  writer.y = pageSize[1] - margin;
  drawText(writer, 'INTERNAL SALES BRIEF / CONTINUED', { size: 10, font: 'bold', color: accent });
  writer.y -= 16;
};

const wrapPdfText = (text: string, measure: (value: string) => number, width: number) => {
  // Split long tokens using real font metrics, including URLs, without clipping or truncation.
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      const chunks: string[] = [];
      let chunk = '';
      for (const { segment: character } of new Intl.Segmenter('und', {
        granularity: 'grapheme',
      }).segment(word)) {
        if (chunk && measure(chunk + character) > width) {
          chunks.push(chunk);
          chunk = '';
        }
        chunk += character;
      }
      if (chunk) {
        chunks.push(chunk);
      }
      return chunks;
    });
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
};

const pdfDisplayText = (writer: Writer, text: string, strong: boolean) => {
  try {
    writer.fonts.runs(text.replaceAll(/\s+/g, ' '), strong);
    return text;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Unsupported PDF text')) {
      throw error;
    }
    return error.message;
  }
};

/** Wraps text to the content width and draws it, starting a new page when the block does not fit. */
const drawText = (
  writer: Writer,
  text: string,
  options: {
    size?: number;
    font?: 'regular' | 'bold';
    color?: ReturnType<typeof rgb>;
    indent?: number;
    link?: string;
  } = {}
) => {
  const size = options.size ?? 11;
  const indent = options.indent ?? 0;
  const width = contentWidth - indent;
  const display = pdfDisplayText(writer, text, options.font === 'bold');
  const direction = writer.fonts.direction(display);
  const widths = new Map<string, number>();
  const measure = (value: string) => {
    const cached = widths.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const measured = writer.fonts.width(value, size, options.font === 'bold', direction);
    widths.set(value, measured);
    return measured;
  };
  for (const current of wrapPdfText(display, measure, width)) {
    if (writer.y - size * 1.4 < margin + 28) {
      newPage(writer);
    }
    const left = margin + indent + (direction === 'rtl' ? width - measure(current) : 0);
    writer.fonts.draw(writer.page, current, {
      x: left,
      y: writer.y - size,
      size,
      color: options.color ?? ink,
      strong: options.font === 'bold',
      direction,
    });
    if (options.link) {
      const annotation = writer.doc.context.register(
        writer.doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [left, writer.y - size * 1.3, left + Math.min(width, measure(current)), writer.y],
          Border: [0, 0, 0],
          A: { Type: 'Action', S: 'URI', URI: PDFString.of(options.link) },
        })
      );
      // eslint-disable-next-line new-cap -- Annots is pdf-lib's existing accessor for the PDF annotation array.
      const annotations = writer.page.node.Annots() ?? writer.doc.context.obj([]);
      annotations.push(annotation);
      writer.page.node.set(PDFName.of('Annots'), annotations);
    }
    writer.y -= size * 1.4;
  }
};

const drawHeading = (writer: Writer, text: string) => {
  // Reserve heading + two body lines so a heading cannot be orphaned at the page bottom.
  if (writer.y < margin + 110) {
    newPage(writer);
  }
  writer.y -= 14;
  drawText(writer, text, { size: 11, font: 'bold', color: accent });
  writer.y -= 2;
};

/** Renders the brief to a one-or-more-page PDF. Values are copied as text, never interpreted as markup. */
export const renderBriefPdf = async (input: BriefInput): Promise<Uint8Array> => {
  const document = await PDFDocument.create();
  const content = buildExportContent(input).internal;
  const fonts = await loadBriefFonts(document, JSON.stringify(content));
  const writer: Writer = {
    doc: document,
    page: document.addPage(pageSize),
    y: pageSize[1] - margin,
    fonts,
    synthetic: content.synthetic,
  };
  // An exact logical-text companion preserves unsupported glyphs and original line breaks.
  await document.attach(
    Buffer.from(
      JSON.stringify(
        {
          company: content.company,
          sections: content.sections,
          linkedin: linkedinProfile(input.lead),
          booking: exportLink(input.bookingUrl),
        },
        null,
        2
      ),
      'utf8'
    ),
    'brief-text.txt',
    {
      mimeType: 'text/plain',
      description:
        'Original internal brief text (UTF-8); includes any text not supported by the bundled fonts',
    }
  );
  document.setTitle('Confidential - Internal sales brief');
  document.setAuthor('meshX');

  const logo = await document.embedPng(Buffer.from(wordmarkPngBase64, 'base64'));
  const logoHeight = (130 * logo.height) / logo.width;
  writer.page.drawImage(logo, {
    x: margin,
    y: writer.y - logoHeight,
    width: 130,
    height: logoHeight,
  });
  writer.y -= logoHeight + 12;
  drawText(writer, 'Confidential / Internal sales brief', {
    size: 11,
    font: 'bold',
    color: accent,
  });
  if (content.synthetic) {
    drawText(writer, 'DEMO DATA', { size: 18, font: 'bold', color: accent });
  }
  drawText(writer, content.company, { size: 24, font: 'bold' });
  for (const { title, lines } of content.sections) {
    drawHeading(writer, title);
    for (const line of lines) {
      drawText(writer, line, {
        size: 10.5,
        link: line.startsWith('Source ')
          ? exportLink(line.replace(/^Source \d+: /, ''))
          : undefined,
      });
      writer.y -= 4;
    }
  }
  const linkedin = linkedinProfile(input.lead);
  if (linkedin) {
    drawHeading(writer, 'Contact link');
    drawText(writer, linkedin, { link: linkedin });
  }
  const booking = exportLink(input.bookingUrl);
  if (booking) {
    drawHeading(writer, 'Scheduling');
    drawText(writer, `Book the next meeting: ${booking}`, { link: booking });
  }
  const pages = document.getPages();
  for (const [index, page] of pages.entries()) {
    page.drawLine({
      start: { x: margin, y: 53 },
      end: { x: pageSize[0] - margin, y: 53 },
      thickness: 0.5,
      color: muted,
    });
    fonts.draw(
      page,
      `meshX / Confidential / Internal only${writer.synthetic ? ' / DEMO DATA' : ''}`,
      {
        x: margin,
        y: 36,
        size: 10,
        color: muted,
      }
    );
    fonts.draw(page, `${index + 1} / ${pages.length}`, {
      x: pageSize[0] - margin - 35,
      y: 36,
      size: 10,
      color: muted,
    });
  }

  return document.save();
};
/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods */
