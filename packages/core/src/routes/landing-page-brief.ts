import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// The one-page meeting brief for a sales lead: who they are, the company, how the chat went, and what to
// cover next. Styled with the meshX deck's palette (warm off-white, red accent, serif type). Rendered to
// PDF by a local Chrome, so it needs no extra npm dependency.

const execFileAsync = promisify(execFile);
const defaultChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export type BriefInput = {
  lead: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    role?: string;
    decision?: string;
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
  .wordmark span { color: #FC3209; }
  h1 { font-size: 22pt; margin: 14px 0 4px; font-weight: normal; }
  h2 { font-size: 12pt; margin: 18px 0 6px; color: #FC3209; text-transform: uppercase; letter-spacing: 0.06em; }
  .card { background: #FDFDFD; border: 1px solid #E4E2DA; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
  .muted { color: #6F6C66; font-size: 10pt; }
  .meta { color: #6F6C66; font-size: 10pt; }
  ul { margin: 4px 0 0 18px; padding: 0; }
  li { margin-bottom: 4px; }
  .booking { margin-top: 18px; padding: 10px 14px; border-left: 4px solid #FC3209; background: #FDFDFD; }
  a { color: #FC3209; }
  footer { margin-top: 24px; font-size: 8pt; color: #6F6C66; }
</style></head>
<body>
  <div class="wordmark">meshx<span>.</span></div>
  <h1>Meeting brief: ${escapeHtml(lead.company)}</h1>
  <p class="meta">Prepared for the sales team${profile?.generatedAt ? ` · ${escapeHtml(profile.generatedAt.slice(0, 10))}` : ''}</p>

  <h2>The lead</h2>
  <div class="card">
    <p><strong>${escapeHtml(name)}</strong>${lead.role ? `, ${escapeHtml(lead.role)}` : ''}</p>
    <p class="meta">${escapeHtml(lead.email)}</p>
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

/** Renders the brief HTML to a PDF with a local Chrome. The temporary files are removed afterwards. */
export const renderBriefPdf = async (html: string): Promise<Uint8Array> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meshx-brief-'));
  const htmlFile = path.join(directory, 'brief.html');
  const pdfFile = path.join(directory, 'brief.pdf');

  try {
    await writeFile(htmlFile, html, 'utf8');
    await execFileAsync(process.env.CHROME_PATH ?? defaultChromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfFile}`,
      `file://${htmlFile}`,
    ]);

    return await readFile(pdfFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
