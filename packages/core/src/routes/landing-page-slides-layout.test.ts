import AdmZip from 'adm-zip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { type BriefInput } from './landing-page-brief.js';
import { wrapSlideText } from './landing-page-slide-layout.js';
import { buildSlidesDeck } from './landing-page-slides.js';

const fixture: BriefInput = {
  lead: {
    firstName: 'PRIVATE_NAME',
    lastName: 'PRIVATE_SURNAME',
    company: 'Air Example',
    email: 'PRIVATE_EMAIL@example.invalid',
    decision: 'Understand aircraft turnaround delays',
  },
  profile: {
    summary: 'Air Example operates regional flights.',
    sources: Array.from({ length: 5 }, (_, index) => `https://air.example/research/${index + 1}`),
    generatedAt: '2026-10-21',
    conversation: {
      tone: 'PRIVATE_TONE',
      outcomes: ['PRIVATE_OUTCOME'],
      nextSteps: ['PRIVATE_DRAFT'],
    },
  },
  exportContext: {
    notes: 'PRIVATE_NOTE',
    status: 'PRIVATE_STAGE',
    tags: ['PRIVATE_TAG'],
    transcript: [{ role: 'user', content: 'PRIVATE_QUOTE' }],
  },
};
const archive = (bytes: Uint8Array) => new AdmZip(Buffer.from(bytes)).getEntries();
const slideXml = (bytes: Uint8Array) =>
  archive(bytes)
    .filter(({ entryName }) => /^ppt\/slides\/slide\d+\.xml$/.test(entryName))
    .toSorted(
      (left, right) =>
        Number(/\d+/.exec(left.entryName)?.[0]) - Number(/\d+/.exec(right.entryName)?.[0])
    )
    .map((entry) => entry.getData().toString('utf8'));
const textShapes = (xml: string) =>
  Array.from(xml.matchAll(/<p:sp>([\S\s]*?)<\/p:sp>/g), ([, shape = '']) => ({
    xml: shape,
    name: /<p:cNvPr[^>]*name="([^"]+)"/.exec(shape)?.[1],
    text: Array.from(shape.matchAll(/<a:t>([\S\s]*?)<\/a:t>/g), ([, text]) => text ?? '').join(
      '\n'
    ),
    left: Number(/<a:off x="(\d+)"/.exec(shape)?.[1]) / 914_400,
    top: Number(/<a:off x="\d+" y="(\d+)"/.exec(shape)?.[1]) / 914_400,
    width: Number(/<a:ext cx="(\d+)"/.exec(shape)?.[1]) / 914_400,
    height: Number(/<a:ext cx="\d+" cy="(\d+)"/.exec(shape)?.[1]) / 914_400,
    size: Number(/\bsz="(\d+)"/.exec(shape)?.[1]) / 100,
  })).filter(({ text }) => text.length > 0);

describe('portable prospect slide layout', () => {
  it('uses a company-led cover and five-slide narrative with five grouped clickable sources', async () => {
    const bytes = await buildSlidesDeck(fixture, '2026-10-24');
    const slides = slideXml(bytes);
    expect(slides).toHaveLength(5);
    const cover = textShapes(slides[0] ?? '');
    expect(cover.find(({ name }) => name === 'company-title')?.text).toBe('Air Example');
    expect(cover.find(({ name }) => name === 'company-title')?.size).toBeGreaterThanOrEqual(40);
    expect(slides[1]).toContain('Stated objective');
    expect(slides[2]).toContain('Company research');
    expect(slides[3]).toContain('Proposed agenda');
    expect(slides[4]).toContain('Research references');
    const sourceLinks = Array.from(
      (slides[4] ?? '').matchAll(/<a:hlinkClick[^>]+r:id="([^"]+)"/g),
      ([, id]) => id
    );
    expect(new Set(sourceLinks).size).toBe(5);
    const all = archive(bytes)
      .map((entry) => entry.getData().toString('utf8'))
      .join('\n');
    expect(all).not.toContain('PRIVATE_');
    expect(all).not.toContain('Stack Sans');
    expect(all).not.toContain('Define the next conversation');
    expect(all).not.toContain('Company context');
    expect(all).toContain('typeface="Arial"');
  });

  it('places editable text inside safe gutters with enough height and ASCII metric width', async () => {
    const slides = slideXml(await buildSlidesDeck(fixture, '2026-10-24'));
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const xml of slides) {
      for (const shape of textShapes(xml)) {
        expect(shape.xml).toContain('txBox="1"');
        expect(shape.left).toBeGreaterThanOrEqual(0.5);
        expect(shape.top).toBeGreaterThanOrEqual(0.5);
        expect(shape.left + shape.width).toBeLessThanOrEqual(12.84);
        expect(shape.top + shape.height).toBeLessThanOrEqual(7.01);
        expect(shape.size).toBeGreaterThanOrEqual(shape.name?.includes('footer') ? 10 : 14);
        const font = shape.xml.includes('b="1"') ? bold : regular;
        const lines = shape.text.split('\n');
        expect(lines.length * shape.size * 1.12).toBeLessThanOrEqual(shape.height * 72);
        for (const line of lines) {
          expect(font.widthOfTextAtSize(line, shape.size)).toBeLessThanOrEqual(shape.width * 72);
        }
      }
    }
  });

  it('wraps by width rather than a fixed count, preserving long Unicode tokens on continuation covers', async () => {
    expect(wrapSlideText('operations '.repeat(12), 11.8, 18).length).toBeLessThan(4);
    const company = '東京' + 'W'.repeat(900) + 'COMPANY_END';
    const source = 'https://air.example/' + 'M'.repeat(1600) + 'URL_END';
    const slides = slideXml(
      await buildSlidesDeck(
        {
          ...fixture,
          lead: { ...fixture.lead, company },
          profile: { ...fixture.profile, sources: [source] },
        },
        '2026-10-24'
      )
    );
    const names = slides
      .flatMap((xml) => textShapes(xml))
      .filter(({ name }) => name === 'company-title');
    expect(names.length).toBeGreaterThan(1);
    expect(names.map(({ text }) => text.replaceAll('\n', '')).join('')).toBe(company);
    const sources = slides
      .flatMap((xml) => textShapes(xml))
      .filter(({ name }) => name?.startsWith('citation-url'));
    expect(sources.map(({ text }) => text.replaceAll('\n', '')).join('')).toBe(source);
    expect(names.every(({ text }) => text.split('\n').length <= 3)).toBe(true);
    expect(slides.every((xml) => xml.includes('DEMO DATA'))).toBe(true);
    const pdf = await PDFDocument.create();
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const shape of slides.flatMap((xml) => textShapes(xml))) {
      expect(shape.left + shape.width).toBeLessThanOrEqual(12.84);
      expect(shape.top + shape.height).toBeLessThanOrEqual(7.01);
      const lines = shape.text.split('\n');
      expect(lines.length * shape.size * 1.12).toBeLessThanOrEqual(shape.height * 72);
      if (shape.name === 'company-title') {
        for (const line of lines) {
          const latin = line.replaceAll(/[京東]/g, '');
          const wideGlyphCount = Array.from(line).length - Array.from(latin).length;
          expect(
            bold.widthOfTextAtSize(latin, shape.size) + wideGlyphCount * shape.size
          ).toBeLessThanOrEqual(shape.width * 72);
        }
      }
    }
  });
});
