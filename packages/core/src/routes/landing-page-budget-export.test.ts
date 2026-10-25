import { adminTenantId } from '@logto/schemas';
import AdmZip from 'adm-zip';
import Koa from 'koa';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import request from 'supertest';

import * as brief from './landing-page-brief.js';
import { parseBudgetAssessment } from './landing-page-budget.js';
import { buildExportContent } from './landing-page-export-content.js';
import { signLeadFileQuery } from './landing-page-signed.js';
import { buildSlidesDeck } from './landing-page-slides.js';

const { jest } = import.meta;
const assessment = parseBudgetAssessment(
  {
    indicativeAnnualRange: { low: 12_000, base: 24_000, high: 48_000 },
    confidence: 'medium',
    rationale: ['BUDGET_RATIONALE: public scale is context, not available funds.'],
    assumptions: ['BUDGET_ASSUMPTION: scope requires validation.'],
    discoveryQuestions: ['BUDGET_DISCOVERY: who approves spend?'],
    evidence: [
      {
        sourceUrl: 'https://budget.example.invalid/about',
        quote: 'BUDGET_QUOTE operates regional offices.',
        signal: 'BUDGET_SIGNAL scale context only',
      },
    ],
  },
  {
    company: 'Example Company',
    sources: [
      {
        url: 'https://budget.example.invalid/about',
        text: 'BUDGET_QUOTE operates regional offices.',
      },
    ],
  },
  new Date('2026-10-24T10:00:00Z')
);

const input = {
  lead: {
    firstName: 'Ada',
    lastName: 'Example',
    company: 'Example Company',
    email: 'ada@example.invalid',
    decision: 'Explore governed reporting',
  },
  profile: { summary: 'Company summary survives.', budgetAssessment: assessment },
};
const internalText = (value: brief.BriefInput) =>
  buildExportContent(value)
    .internal.sections.flatMap(({ title, lines }) => [title, ...lines])
    .join('\n');

const pdfTexts = async (bytes: Uint8Array) => {
  const pdf = await PDFDocument.load(bytes);
  const streams = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [Buffer.from(decodePDFRawStream(object).decode()).toString('utf8')]
        : []
    );
  const logical = Array.from(
    streams.join('\n').matchAll(/\/ActualText\s*<([\dA-Fa-f]+)>/g),
    ([, hex]) =>
      Buffer.from(hex ?? '', 'hex')
        .swap16()
        .toString('utf16le')
        .replace(/^\uFEFF/, '')
  ).join(' ');
  return { logical, attachment: streams.find((stream) => stream.includes('"sections"')) };
};

describe('budget export audience boundary', () => {
  it('publishes the budget status, a hypothetical suggestion and the discovery questions only', () => {
    expect(assessment).toBeDefined();
    const before = structuredClone(input);
    const text = internalText(input);
    for (const expected of [
      'Budget context and discovery - internal only',
      'Actual opportunity budget: not disclosed',
      'Hypothetical suggestion for sales',
      'BUDGET_DISCOVERY',
      'BUDGET_SIGNAL',
      'BUDGET_QUOTE',
      'https://budget.example.invalid/about',
      'source publication date: not disclosed',
    ]) {
      expect(text).toContain(expected);
    }
    // No budget figure, scenario range, confidence rating or assessment date is published.
    for (const forbidden of [
      'UNCONFIRMED',
      'Confidence',
      'Annual USD scenario range',
      'BUDGET_RATIONALE',
      'BUDGET_ASSUMPTION',
      'budget advisory',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/USD\s?[\d,]/);
    expect(text).not.toMatch(/\b\d{1,3}(,\d{3})+\b/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\d\s*%/);
    expect(input).toEqual(before);
  });

  it('includes the discovery questions in the internal HTML document', () => {
    const html = brief.buildBriefHtml(input);
    expect(html).toContain('Budget context and discovery - internal only');
    expect(html).toContain('BUDGET_DISCOVERY');
    expect(html).toContain('Confidential / Internal');
    expect(html).not.toMatch(/USD\s?[\d,]/);
    expect(html).not.toContain('Confidence');
  });

  it.each([
    undefined,
    { confidential: 'BUDGET_BAD' },
    { ...assessment, indicativeAnnualRange: { low: 3, base: 2, high: 1 } },
    {
      ...assessment,
      indicativeAnnualRange: {
        low: 0,
        base: Number.POSITIVE_INFINITY,
        high: Number.POSITIVE_INFINITY,
      },
    },
  ])('fails soft for missing/malformed unknown budget %j', (budgetAssessment) => {
    const value = { ...input, profile: { ...input.profile, budgetAssessment } };
    const before = structuredClone(value);
    const text = internalText(value);
    expect(text).toContain('Company summary survives.');
    expect(text).toContain('Actual opportunity budget: not disclosed');
    expect(text).toContain('Hypothetical suggestion for sales');
    expect(text).not.toContain('BUDGET_');
    expect(text).not.toContain('USD');
    expect(value).toEqual(before);
  });

  it('publishes no scenario range when the assessment has none', () => {
    const text = internalText({
      ...input,
      profile: {
        ...input.profile,
        budgetAssessment: { ...assessment, indicativeAnnualRange: null, confidence: 'low' },
      },
    });
    expect(text).toContain('Actual opportunity budget: not disclosed');
    expect(text).toContain('BUDGET_DISCOVERY');
    expect(text).not.toContain('USD');
    expect(text).not.toContain('Confidence');
  });

  it('keeps the exact prospect whitelist and every actual PPTX archive entry free of budget', async () => {
    const before = structuredClone(input);
    const projected = buildExportContent(input).prospect;
    expect(Object.keys(projected)).toEqual([
      'company',
      'objective',
      'summary',
      'sources',
      'researchDate',
      'synthetic',
      'questions',
    ]);
    expect(projected).toEqual(
      buildExportContent({ ...input, profile: { summary: input.profile.summary } }).prospect
    );
    const archive = new AdmZip(await buildSlidesDeck(input, '2026-10-24'));
    for (const entry of archive.getEntries()) {
      const text = `${entry.entryName}\n${entry.getData().toString('utf8')}`;
      expect(text).not.toMatch(
        /budget_|budget\.example\.invalid|1,500,000|1500000|150\/month|usd 150|12,000|24,000|48,000|brief-text\.txt|budget advisory|annual, unconfirmed/i
      );
    }
    expect(input).toEqual(before);
  });

  it.each([assessment, undefined])(
    'preserves the budget status and discovery questions in real PDF logical text and internal attachment',
    async (budgetAssessment) => {
      const value = { ...input, profile: { ...input.profile, budgetAssessment } };
      const before = structuredClone(value);
      const text = await pdfTexts(await brief.renderBriefPdf(value));
      for (const part of [text.logical, text.attachment]) {
        expect(part).toContain('Budget context and discovery - internal only');
        expect(part).toContain('Actual opportunity budget: not disclosed');
        expect(part).toContain('Hypothetical suggestion for sales');
        expect(part).not.toContain('Confidence');
        expect(part).not.toMatch(/USD\s?[\d,]/);
        expect(part).not.toContain('"prospect"');
      }
      expect(text.logical).toContain('Confidential');
      if (budgetAssessment) {
        expect(text.logical).toContain('BUDGET_DISCOVERY');
        expect(text.attachment).toContain('BUDGET_QUOTE');
      }
      expect(value).toEqual(before);
    }
  );
});

const maybeOne = jest.fn(async (_query: unknown): Promise<unknown> => undefined);
const renderPdf = jest.fn(brief.renderBriefPdf);
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: {
    values: {
      isDevFeaturesEnabled: true,
      cloudUrlSet: { endpoint: new URL('https://admin.example.invalid') },
    },
    sharedPool: Promise.resolve({ maybeOne }),
  },
}));
jest.unstable_mockModule('#src/middleware/koa-auth/index.js', () => ({
  verifyBearerTokenFromRequest: async () => ({
    sub: 'test-user',
    clientId: 'test-client',
    scopes: ['manage:landing:page'],
  }),
}));
jest.unstable_mockModule('./landing-page-brief.js', () => ({
  ...brief,
  renderBriefPdf: renderPdf,
}));
const { landingPageLeadRoutes } = await import('./landing-page-leads.js');

describe('selected lead budget export loading', () => {
  const oldSecret = process.env.LANDING_LEAD_LINK_SECRET;
  beforeEach(() => {
    maybeOne.mockReset();
    renderPdf.mockClear();
    process.env.LANDING_LEAD_LINK_SECRET = 'synthetic-budget-export-test-secret';
  });
  afterAll(() => {
    if (oldSecret === undefined) {
      // eslint-disable-next-line @silverhand/fp/no-delete -- Restore only this test's environment key.
      delete process.env.LANDING_LEAD_LINK_SECRET;
    } else {
      process.env.LANDING_LEAD_LINK_SECRET = oldSecret;
    }
  });
  it.each([
    { mode: 'direct', valid: true },
    { mode: 'direct', valid: false },
    { mode: 'signed', valid: true },
    { mode: 'signed', valid: false },
  ])('loads selected lead via $mode with valid budget=$valid', async ({ mode, valid }) => {
    const app = new Koa();
    app.use(landingPageLeadRoutes({} as never).routes());
    const sessionId = 'selected-budget-lead';
    const signed = signLeadFileQuery('synthetic-budget-export-test-secret', 'brief', sessionId);
    const path =
      mode === 'direct'
        ? `/api/landing-leads/${sessionId}/brief.pdf`
        : `/api/landing-lead-files/brief/${sessionId}?${new URLSearchParams(signed).toString()}`;
    const budgetAssessment = valid ? assessment : { bad: 'BUDGET_BAD' };
    maybeOne
      .mockResolvedValueOnce({
        lead: input.lead,
        companyProfile: { ...input.profile, budgetAssessment },
      })
      .mockResolvedValueOnce({ messages: [] });
    const response = await request(app.callback()).get(path).expect(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    const loaded = renderPdf.mock.calls.at(-1)?.[0];
    expect(loaded?.profile?.summary).toBe('Company summary survives.');
    expect(loaded?.profile).toHaveProperty('budgetAssessment', valid ? assessment : undefined);
    for (const [query] of maybeOne.mock.calls) {
      expect(query).toEqual(
        expect.objectContaining({
          sql: expect.stringContaining('tenant_id =') as unknown,
          values: [adminTenantId, sessionId],
        })
      );
    }
  });
});
