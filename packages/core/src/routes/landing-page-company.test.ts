/* eslint-disable @silverhand/fp/no-mutating-methods -- The tests record each call they receive, so they append to local lists. */
import { createMockUtils } from '@logto/shared/esm';

import { parseBudgetAssessment } from './landing-page-budget.js';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);
mockEsm('node:dns/promises', () => ({
  lookup: async (domain: string) => [
    { address: domain === 'localhost' ? '127.0.0.1' : '203.0.113.8' },
  ],
}));
const {
  companyDomainFromEmail,
  htmlToText,
  profileCompany,
  resolvesToPublicAddress,
  robotsAllowsRoot,
  summarizeCompanyText,
} = await import('./landing-page-company.js');

describe('companyDomainFromEmail', () => {
  it('returns the company domain of a work email', () => {
    expect(companyDomainFromEmail('Sam@Acme-Logistics.com')).toBe('acme-logistics.com');
  });

  it('returns nothing for free email providers', () => {
    expect(companyDomainFromEmail('sam@gmail.com')).toBeUndefined();
  });

  it('returns nothing for input that is not an email domain', () => {
    expect(companyDomainFromEmail('not-an-email')).toBeUndefined();
    expect(companyDomainFromEmail('sam@localhost')).toBeUndefined();
  });
});

describe('robotsAllowsRoot', () => {
  it('allows a site with no robots.txt', () => {
    expect(robotsAllowsRoot()).toBe(true);
  });

  it('refuses when every crawler is told to stay out', () => {
    expect(robotsAllowsRoot('User-agent: *\nDisallow: /\n')).toBe(false);
  });

  it('allows when the block is for another crawler only', () => {
    expect(
      robotsAllowsRoot('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\n')
    ).toBe(true);
  });
});

describe('htmlToText', () => {
  it('keeps visible text and drops scripts, styles and tags', () => {
    const html =
      '<html><style>p{color:red}</style><body><script>alert(1)</script><p>We ship &amp; track freight.</p></body></html>';
    expect(htmlToText(html)).toBe('We ship & track freight.');
  });
});

describe('resolvesToPublicAddress', () => {
  it('refuses a domain that resolves to a private address', async () => {
    await expect(resolvesToPublicAddress('localhost')).resolves.toBe(false);
  });
});

describe('profileCompany', () => {
  const options = {
    fetchPage: async (url: string) =>
      new Response(
        url.endsWith('robots.txt')
          ? ''
          : `<p>${url.endsWith('/about') ? 'About only' : 'Home only'}</p>`
      ),
    summarize: async () => 'Original company summary',
    now: () => new Date('2026-10-24T00:00:00.000Z'),
  };

  it('keeps the original profile when no budget callback is supplied', async () => {
    expect(await profileCompany('rep@example.test', options)).toMatchObject({
      summary: 'Original company summary',
      generatedAt: '2026-10-24T00:00:00.000Z',
    });
    expect(await profileCompany('rep@example.test', options)).not.toHaveProperty(
      'budgetAssessment'
    );
  });

  it('passes exact per-page text and retains only source-backed quotes', async () => {
    const assessBudget = jest.fn(async (sources: Array<{ url: string; text: string }>) => {
      expect(sources.find(({ url }) => url.endsWith('/about'))?.text).toBe('About only');
      return parseBudgetAssessment(
        {
          indicativeAnnualRange: { low: 100, base: 200, high: 300 },
          confidence: 'medium',
          rationale: [],
          assumptions: [],
          discoveryQuestions: [],
          evidence: [
            { sourceUrl: 'https://example.test/about', quote: 'About only', signal: 'Context' },
            { sourceUrl: 'https://example.test/about', quote: 'Home only', signal: 'Wrong page' },
          ],
        },
        { company: 'Example', sources }
      );
    });
    const profile = await profileCompany('rep@example.test', { ...options, assessBudget });
    expect(assessBudget).toHaveBeenCalledTimes(1);
    expect(profile?.budgetAssessment?.evidence).toEqual([
      { sourceUrl: 'https://example.test/about', quote: 'About only', signal: 'Context' },
    ]);
    expect(profile?.summary).toBe('Original company summary');
  });

  it.each(['reject', 'undefined', 'invalid'])(
    'preserves the summary on %s budget',
    async (result) => {
      const assessBudget = async () => {
        if (result === 'reject') {
          throw new Error('Model unavailable');
        }
        return result === 'invalid' ? { currency: 'USD' } : undefined;
      };
      expect(await profileCompany('rep@example.test', { ...options, assessBudget })).toEqual(
        await profileCompany('rep@example.test', options)
      );
    }
  );

  it('does nothing for a free email provider and never fetches', async () => {
    const fetched: string[] = [];
    const profile = await profileCompany('sam@gmail.com', {
      fetchPage: async (url) => {
        fetched.push(url);
        return new Response('<p>hi</p>');
      },
      summarize: async () => 'unused',
    });

    expect(profile).toBeUndefined();
    expect(fetched).toHaveLength(0);
  });
});

describe('summarizeCompanyText', () => {
  it('sends the page text as data with the brief instructions and returns the reply', async () => {
    const sent: Array<{ body: string }> = [];
    const summary = await summarizeCompanyText('We run cold-chain freight.', {
      endpoint: 'http://model.test',
      apiKey: 'key',
      model: 'test-model',

      fetch: (async (_url: string, init: { body: string }) => {
        sent.push({ body: init.body });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'Cold-chain freight company.' } }] })
        );
      }) as unknown as typeof fetch,
    });

    expect(summary).toBe('Cold-chain freight company.');
    expect(sent[0]?.body).toContain('We run cold-chain freight.');
  });
});

/* eslint-enable @silverhand/fp/no-mutating-methods */
