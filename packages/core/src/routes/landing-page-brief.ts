import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { wordmarkPngBase64 } from './landing-page-brand.js';

// The one-page meeting brief for a sales lead: who they are, the company, how the chat went, and what to
// cover next. Rendered to PDF in code with pdf-lib, so it needs no browser in the image.

export type BriefInput = {
  lead: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    role?: string;
    decision?: string;
    contactMethod?: string;
    contactDetail?: string;
  };
  profile?: {
    summary?: string;
    domain?: string;
    sources?: string[];
    generatedAt?: string;
    conversation?: { tone?: string; outcomes?: string[]; nextSteps?: string[] };
  };
  bookingUrl?: string | undefined;
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

const list = (items: string[] | undefined, fallback: string) =>
  items && items.length > 0
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : `<p class="muted">${escapeHtml(fallback)}</p>`;

/** The brief as a standalone HTML page. Every value from the lead or the model is escaped. */
export const buildBriefHtml = (input: BriefInput): string => {
  const { lead, profile } = input;
  const linkedin = linkedinProfile(lead);
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  const conversation = profile?.conversation;
  const bookingLink = input.bookingUrl
    ? `<p class="booking">Book the next meeting: <a href="${escapeHtml(input.bookingUrl)}">${escapeHtml(input.bookingUrl)}</a></p>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Meeting brief: ${escapeHtml(lead.company)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { margin: 0; background: #F0EEE6; color: #1F1E1C; font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.45; }
  .wordmark { font-size: 16pt; font-weight: bold; color: #1F1E1C; }
  .wordmark span { color: #1F1F23; }
  h1 { font-size: 22pt; margin: 14px 0 4px; font-weight: normal; }
  h2 { font-size: 12pt; margin: 18px 0 6px; color: #1F1F23; text-transform: uppercase; letter-spacing: 0.06em; }
  .card { background: #FDFDFD; border: 1px solid #E4E2DA; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
  .muted { color: #6F6C66; font-size: 10pt; }
  .meta { color: #6F6C66; font-size: 10pt; }
  ul { margin: 4px 0 0 18px; padding: 0; }
  li { margin-bottom: 4px; }
  .booking { margin-top: 18px; padding: 10px 14px; border-left: 4px solid #1F1F23; background: #FDFDFD; }
  a { color: #1F1F23; }
  footer { margin-top: 24px; font-size: 8pt; color: #6F6C66; }
</style></head>
<body>
  <img class="wordmark" alt="meshX" width="160" src="data:image/png;base64,${wordmarkPngBase64}">
  <h1>Meeting brief: ${escapeHtml(lead.company)}</h1>
  <p class="meta">Prepared for the sales team${profile?.generatedAt ? ` · ${escapeHtml(profile.generatedAt.slice(0, 10))}` : ''}</p>

  <h2>The lead</h2>
  <div class="card">
    <p><strong>${escapeHtml(name)}</strong>${lead.role ? `, ${escapeHtml(lead.role)}` : ''}</p>
    <p class="meta">${escapeHtml(lead.email)}</p>
    ${linkedin ? `<p class="meta">LinkedIn: <a href="${escapeHtml(linkedin)}">${escapeHtml(linkedin)}</a></p>` : ''}
    ${lead.decision ? `<p>Wants to see: ${escapeHtml(lead.decision)}</p>` : ''}
  </div>

  <h2>The company</h2>
  <div class="card">
    ${profile?.summary ? `<p>${escapeHtml(profile.summary)}</p>` : '<p class="muted">No company profile yet. The company website could not be read.</p>'}
    ${profile?.sources && profile.sources.length > 0 ? `<p class="meta">Sources: ${profile.sources.map((url) => escapeHtml(url)).join(', ')}</p>` : ''}
  </div>

  <h2>How the conversation went</h2>
  <div class="card">
    <p><strong>Tone:</strong> ${escapeHtml(conversation?.tone ?? 'not yet analysed')}</p>
    <p><strong>Likely outcomes</strong></p>
    ${list(conversation?.outcomes, 'Not yet analysed.')}
  </div>

  <h2>Cover in the next meeting</h2>
  <div class="card">
    ${list(conversation?.nextSteps, 'Start from the decision the visitor named, and ask what it would change for their team.')}
  </div>

  ${bookingLink}
  <footer>meshX · Confidential: contains a prospect's contact details. Share only with the sales team.</footer>
</body></html>`;
};

// Standard PDF fonts only cover WinAnsi, so anything else is replaced rather than failing the render.
const toWinAnsi = (value: string) => value.replaceAll(/[^ -~ -ÿ]/g, '?');

const pageSize: [number, number] = [595.28, 841.89];
const margin = 52;
const contentWidth = pageSize[0] - margin * 2;
const accent = rgb(0.122, 0.122, 0.137); // 1F1F23, the deck accent
const ink = rgb(0.055, 0.055, 0.055); // 0E0E0E
const muted = rgb(0.388, 0.384, 0.373); // 63625F

type Writer = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
};

const newPage = (writer: Writer) => {
  writer.page = writer.doc.addPage(pageSize);
  writer.y = pageSize[1] - margin;
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
  } = {}
) => {
  const size = options.size ?? 11;
  const font = options.font === 'bold' ? writer.bold : writer.regular;
  const width = contentWidth - (options.indent ?? 0);
  const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }

  for (const current of lines.length > 0 ? lines : ['']) {
    if (writer.y - size * 1.4 < margin) {
      newPage(writer);
    }
    writer.page.drawText(current, {
      x: margin + (options.indent ?? 0),
      y: writer.y - size,
      size,
      font,
      color: options.color ?? ink,
    });
    writer.y -= size * 1.4;
  }
};

const drawHeading = (writer: Writer, text: string) => {
  writer.y -= 14;
  drawText(writer, text.toUpperCase(), { size: 10, font: 'bold', color: accent });
  writer.y -= 2;
};

const drawItems = (writer: Writer, items: string[] | undefined, fallback: string) => {
  if (!items || items.length === 0) {
    drawText(writer, fallback, { size: 10, color: muted });
    return;
  }
  for (const item of items) {
    drawText(writer, `- ${item}`, { size: 10.5, indent: 10 });
  }
};

/** Renders the brief to a one-or-more-page PDF. Values are copied as text, never interpreted as markup. */
export const renderBriefPdf = async (input: BriefInput): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const writer: Writer = {
    doc,
    page: doc.addPage(pageSize),
    y: pageSize[1] - margin,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const { lead, profile } = input;
  const linkedin = linkedinProfile(lead);
  const conversation = profile?.conversation;
  const name = `${lead.firstName} ${lead.lastName}`.trim();

  const logo = await doc.embedPng(Buffer.from(wordmarkPngBase64, 'base64'));
  const logoWidth = 130;
  const logoHeight = (logoWidth * logo.height) / logo.width;
  writer.page.drawImage(logo, {
    x: margin,
    y: writer.y - logoHeight,
    width: logoWidth,
    height: logoHeight,
  });
  writer.y -= logoHeight + 12;
  drawText(writer, `Meeting brief: ${lead.company}`, { size: 20, font: 'bold' });
  drawText(
    writer,
    `Prepared for the sales team${profile?.generatedAt ? ` - ${profile.generatedAt.slice(0, 10)}` : ''}`,
    { size: 9.5, color: muted }
  );

  drawHeading(writer, 'The lead');
  drawText(writer, `${name}${lead.role ? `, ${lead.role}` : ''}`, { size: 12, font: 'bold' });
  drawText(writer, lead.email, { size: 10, color: muted });
  if (linkedin) {
    drawText(writer, `LinkedIn: ${linkedin}`, { size: 10, color: muted });
  }
  if (lead.decision) {
    drawText(writer, `Wants to see: ${lead.decision}`, { size: 10.5 });
  }

  drawHeading(writer, 'The company');
  drawText(
    writer,
    profile?.summary ?? 'No company profile yet. The company website could not be read.',
    { size: 10.5, color: profile?.summary ? ink : muted }
  );
  if (profile?.sources && profile.sources.length > 0) {
    drawText(writer, `Sources: ${profile.sources.join(', ')}`, { size: 9, color: muted });
  }

  drawHeading(writer, 'How the conversation went');
  drawText(writer, `Tone: ${conversation?.tone ?? 'not yet analysed'}`, { size: 10.5 });
  drawText(writer, 'Likely outcomes', { size: 10.5, font: 'bold' });
  drawItems(writer, conversation?.outcomes, 'Not yet analysed.');

  drawHeading(writer, 'Cover in the next meeting');
  drawItems(
    writer,
    conversation?.nextSteps,
    'Start from the decision the visitor named, and ask what it would change for their team.'
  );

  if (input.bookingUrl) {
    writer.y -= 14;
    drawText(writer, `Book the next meeting: ${input.bookingUrl}`, { size: 10 });
  }

  writer.y -= 14;
  drawText(
    writer,
    "meshX - Confidential: contains a prospect's contact details. Share only with the sales team.",
    { size: 8, color: muted }
  );

  return doc.save();
};
