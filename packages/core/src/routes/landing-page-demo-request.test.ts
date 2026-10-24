/* eslint-disable @silverhand/fp/no-mutating-methods -- The test records each call it receives, so it appends to a local list. */
import { type DemoLead } from './landing-page-chat-guard.js';
import { createDemoRequest, toDemoRequestBody } from './landing-page-demo-request.js';

const lead: DemoLead = {
  firstName: 'Sam',
  lastName: 'Lee',
  email: 'sam@example.com',
  company: 'Acme',
  role: 'COO',
  industry: 'Logistics',
  interests: ['routing', 'tracking'],
  decision: 'Reduce late deliveries',
  contactMethod: 'email',
  consent: true,
};

describe('toDemoRequestBody', () => {
  it('maps the lead to the portal body and leaves out empty optional fields', () => {
    expect(toDemoRequestBody(lead)).toEqual({
      contact: {
        firstName: 'Sam',
        lastName: 'Lee',
        role: 'COO',
        industry: 'Logistics',
        interested: 'routing, tracking',
        decision: 'Reduce late deliveries',
      },
      email: 'sam@example.com',
      company: 'Acme',
    });
  });

  it('omits optional contact fields the visitor did not give', () => {
    const body = toDemoRequestBody({
      ...lead,
      role: undefined,
      industry: undefined,
      interests: undefined,
      decision: undefined,
    });
    expect(body.contact).toEqual({ firstName: 'Sam', lastName: 'Lee' });
  });
});

describe('createDemoRequest', () => {
  it('does nothing when the portal token is not configured', async () => {
    const calls: unknown[] = [];
    const sent = await createDemoRequest(lead, {
      fetch: async (...args) => {
        calls.push(args);
        return { ok: true, status: 200 };
      },
    });
    expect(sent).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('posts the request with the bearer token to the portal', async () => {
    const seen: Array<{
      url: string;
      init: { method: string; headers: Record<string, string>; body: string };
    }> = [];
    const sent = await createDemoRequest(lead, {
      token: 'shared-token',
      baseUrl: 'http://portal.test',
      fetch: async (url, init) => {
        seen.push({ url, init });
        return { ok: true, status: 200 };
      },
    });

    expect(sent).toBe(true);
    expect(seen[0]?.url).toBe('http://portal.test/api/demorequests');
    expect(seen[0]?.init.method).toBe('POST');
    expect(seen[0]?.init.headers.Authorization).toBe('Bearer shared-token');
    expect(JSON.parse(seen[0]?.init.body ?? '{}')).toMatchObject({ email: 'sam@example.com' });
  });

  it('throws when the portal refuses the request, without the lead in the message', async () => {
    const attempt = createDemoRequest(lead, {
      token: 'shared-token',
      baseUrl: 'http://portal.test',
      fetch: async () => ({ ok: false, status: 401 }),
    });

    await expect(attempt).rejects.toThrow('status 401');
  });
});

/* eslint-enable @silverhand/fp/no-mutating-methods */
