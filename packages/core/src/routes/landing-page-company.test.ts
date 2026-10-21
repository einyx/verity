/* eslint-disable @silverhand/fp/no-mutating-methods -- The tests record each call they receive, so they append to local lists. */
import {
  companyDomainFromEmail,
  htmlToText,
  profileCompany,
  resolvesToPublicAddress,
  robotsAllowsRoot,
  summarizeCompanyText,
} from './landing-page-company.js';

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
