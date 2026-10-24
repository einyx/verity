import AdmZip from 'adm-zip';
import { XMLValidator } from 'fast-xml-parser';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { type BriefInput, renderBriefPdf } from './landing-page-brief.js';
import { buildExportContent, exportLink, wrapExportText } from './landing-page-export-content.js';
import { buildSlidesDeck } from './landing-page-slides.js';

const input: BriefInput = {
  lead: {
    firstName: 'Ada',
    lastName: 'Example',
    company: 'Air Example',
    email: 'PRIVATE_EMAIL@example.invalid',
    contactDetail: 'PRIVATE_CONTACT',
    decision: 'Understand aircraft turnaround delays',
  },
  profile: {
    summary: 'Air Example operates regional flights.',
    sources: ['https://air.example/about'],
    generatedAt: '2026-10-21T10:00:00Z',
    conversation: {
      tone: 'PRIVATE_TONE',
      outcomes: ['PRIVATE_OUTCOME'],
      nextSteps: ['PRIVATE_DRAFT'],
    },
  },
  exportContext: {
    notes: 'PRIVATE_NOTES',
    status: 'PRIVATE_STAGE',
    tags: ['PRIVATE_TAG'],
    transcript: [
      { role: 'user', content: 'PRIVATE_USER_QUOTE' },
      { role: 'assistant', content: 'PRIVATE_ASSISTANT' },
    ],
  },
};

const parts = (file: Uint8Array): string[] =>
  new AdmZip(Buffer.from(file)).getEntries().map((entry) => entry.getData().toString('utf8'));

// Embedded subset glyph IDs are not WinAnsi bytes. ActualText stores logical UTF-16BE text.
const logicalPdfText = (streams: string) =>
  Array.from(streams.matchAll(/\/ActualText\s*<([\dA-Fa-f]+)>/g), ([, hex]) =>
    Buffer.from(hex ?? '', 'hex')
      .swap16()
      .toString('utf16le')
      .replace(/^\uFEFF/, '')
  ).join(' ');

describe('audience-specific export content', () => {
  it('only accepts safe link protocols without embedded credentials', () => {
    // eslint-disable-next-line no-script-url -- Deliberately unsafe test input; never executed.
    expect(exportLink('javascript:alert(1)')).toBeUndefined();
    expect(exportLink('https://user:secret@air.example/')).toBeUndefined();
    expect(exportLink('https://air.example/about')).toBe('https://air.example/about');
  });
  it('projects only approved fields, and only stored user quotes as evidence', () => {
    const content = buildExportContent(input);
    expect(JSON.stringify(content.prospect)).not.toContain('PRIVATE_');
    expect(content.prospect.objective).toBe(input.lead.decision);
    const internal = content.internal.sections.flatMap(({ lines }) => lines).join(' ');
    expect(internal).toContain('PRIVATE_NOTES');
    expect(internal).toContain('PRIVATE_USER_QUOTE');
    expect(internal).not.toContain('PRIVATE_ASSISTANT');
  });

  it('detects synthetic records without treating ordinary demo interest as synthetic', () => {
    expect(buildExportContent(input).prospect.synthetic).toBe(true);
    const ordinary = {
      ...input,
      lead: { ...input.lead, email: 'ada@air.example', decision: 'Book a demo' },
    };
    expect(buildExportContent(ordinary).prospect.synthetic).toBe(false);
    expect(
      buildExportContent({ ...ordinary, profile: { syntheticContact: true } }).prospect.synthetic
    ).toBe(true);
    expect(
      buildExportContent({ ...ordinary, exportContext: { tags: ['synthetic'] } }).prospect.synthetic
    ).toBe(true);
  });

  it('retains distinct context and admits unavailable data', () => {
    const first = buildExportContent(input).prospect;
    const second = buildExportContent({
      lead: { ...input.lead, company: 'Freight Example', decision: '' },
    }).prospect;
    expect(second.company).not.toBe(first.company);
    expect(second.summary).toContain('not available');
    expect(second.objective).toContain('not available');
    expect(second.researchDate).toContain('not available');
  });

  it('wraps long words and URLs without losing characters', () => {
    const word = 'https://air.example/' + 'LongWord'.repeat(150);
    const lines = wrapExportText(word, 40);
    expect(lines.every((line) => Array.from(line).length <= 40)).toBe(true);
    expect(lines.join('')).toBe(word);
    expect(wrapExportText('東京 café', 40).join(' ')).toBe('東京 café');
  });

  it('checks every PPTX part for private sentinels and demo footers on every slide', async () => {
    const xml = parts(await buildSlidesDeck(input, '2026-10-24'));
    expect(xml.join('\n')).not.toContain('PRIVATE_');
    expect(xml.join('\n')).not.toMatch(/30 days|Foundation AI|Likely outcomes/);
    expect(xml.join('\n')).toContain('Stated objective');
    expect(xml.join('\n')).toContain('AI-assisted public website research');
    expect(xml.join('\n')).toContain('2026-10-21');
    expect(xml.join('\n')).toContain('https://air.example/about');
    const slides = xml.filter((part) => part.includes('<p:sld '));
    expect(slides.length).toBeGreaterThanOrEqual(4);
    for (const slide of slides) {
      expect(slide).toContain('DEMO DATA');
      expect(slide).not.toContain('sz="900"');
      const sizes = Array.from(slide.matchAll(/\bsz="(\d+)"/g), ([, size]) => Number(size));
      expect(sizes.every((size) => size >= 1000)).toBe(true);
    }
    for (const part of xml.filter((value) => value.startsWith('<?xml'))) {
      expect(XMLValidator.validate(part)).toBe(true);
    }
  });

  it('paginates long slide content without truncation and preserves Unicode', async () => {
    const summary = '東京 ' + 'longword'.repeat(600) + ' END_OF_SUMMARY';
    const xml = parts(await buildSlidesDeck({ ...input, profile: { summary } }, '2026-10-24')).join(
      '\n'
    );
    expect(xml).toContain('東京');
    expect(xml).toContain('END_OF_SUMMARY');
    expect((xml.match(/<p:sld /g) ?? []).length).toBeGreaterThan(5);
  });

  it('downloads both formats with partial inputs and keeps company relevance distinct in real slides', async () => {
    const partial = { lead: { firstName: '', lastName: '', company: '', email: '' } };
    const emptyDeck = parts(await buildSlidesDeck(partial, '2026-10-24')).join('\n');
    expect(emptyDeck).toContain('not available');
    const partialPdf = await PDFDocument.load(await renderBriefPdf(partial));
    expect(partialPdf.getPageCount()).toBeGreaterThan(0);
    const otherDeck = parts(
      await buildSlidesDeck(
        {
          lead: {
            ...input.lead,
            company: 'Freight Example',
            decision: 'Understand port dwell time',
          },
          profile: { summary: 'Freight Example moves containers by rail.' },
        },
        '2026-10-24'
      )
    ).join('\n');
    const otherText = otherDeck.replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ');
    expect(otherText).toContain('Freight Example moves containers by rail.');
    expect(otherDeck).toContain('Understand port dwell time');
    expect(otherDeck).not.toContain('Air Example');
  });

  it('decodes PDF streams to check evidence and per-page labels', async () => {
    const pdf = await PDFDocument.load(await renderBriefPdf(input));
    const streams = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream
          ? [Buffer.from(decodePDFRawStream(object).decode()).toString('latin1')]
          : []
      )
      .join('\n');
    const text = logicalPdfText(streams);
    expect(text).toContain('PRIVATE_NOTES');
    expect(text).toContain('PRIVATE_USER_QUOTE');
    expect(text).not.toContain('PRIVATE_ASSISTANT');
    expect(text).toContain('AI-inferred');
    expect(text).toContain('Confidential');
    expect((text.match(/DEMO DATA/g) ?? []).length).toBeGreaterThanOrEqual(pdf.getPageCount());
    expect(text).toContain('2026-10-21');
    expect(text).toContain('https://air.example/about');
    expect(text).toContain('Understand aircraft turnaround delays');
  });

  it('retains the end of long internal notes across multiple PDF pages', async () => {
    const pdf = await PDFDocument.load(
      await renderBriefPdf({
        ...input,
        exportContext: { ...input.exportContext, notes: 'LongWord'.repeat(1500) + ' END_OF_NOTES' },
      })
    );
    expect(pdf.getPageCount()).toBeGreaterThan(2);
    const streams = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream
          ? [Buffer.from(decodePDFRawStream(object).decode()).toString('latin1')]
          : []
      )
      .join('\n');
    const text = logicalPdfText(streams);
    expect(text).toContain('END_OF_NOTES');
    expect((text.match(/DEMO DATA/g) ?? []).length).toBeGreaterThanOrEqual(pdf.getPageCount());
  }, 60_000);
});
