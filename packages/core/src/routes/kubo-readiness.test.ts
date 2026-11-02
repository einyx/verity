/* eslint-disable unicorn/no-await-expression-member -- Keep HTTP security assertions local. */
import { readOnlyAccessHeader } from '@logto/schemas';
import { jwtVerify } from 'jose';
import request from 'supertest';

import {
  createApp,
  token,
  proofKey,
  setupKuboTest,
  cleanupKuboTest,
} from '#src/test-utils/kubo.js';

const { jest } = import.meta;

describe('authoritative Kubo readiness capabilities', () => {
  beforeEach(setupKuboTest);
  afterEach(cleanupKuboTest);

  it.each(
    [false, true].flatMap((ready) =>
      [false, true].flatMap((readOnly) =>
        ['ordinary', 'global-scoped', 'operator'].map((view) => ({ ready, readOnly, view }))
      )
    )
  )(
    'uses backend readiness with the scope/read-only matrix %j',
    async ({ ready, readOnly, view }) => {
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ tenantMutationsEnabled: ready })));
      const operator = view === 'operator';
      const response = await request(createApp())
        .get(`/kubo/access${operator ? '?scope=all' : ''}`)
        .set('Authorization', `Bearer ${await token({ nativeSigner: view === 'ordinary' })}`)
        .set(readOnlyAccessHeader, String(readOnly));
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers.etag).toBeUndefined();
      expect(response.body).toEqual({
        canViewAll: view !== 'ordinary',
        operator,
        tenantScoped: !operator,
        canMutate: !readOnly && (operator || ready),
        tenantMutationsEnabled: ready,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] ?? [];
      expect(new URL(String(url)).pathname).toBe('/api/console/readiness');
      expect(new URL(String(url)).search).toBe('');
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      const proof = new Headers(init?.headers).get('X-Kubo-Console-Context') ?? '';
      expect(
        (await jwtVerify(proof, proofKey, { issuer: 'verity-console', audience: 'kubo-portal' }))
          .payload
      ).toMatchObject({
        sub: 'operator',
        tenantId: 'tenant-a',
        operator,
        method: 'GET',
        path: '/api/console/readiness',
        bodySha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      });
    }
  );

  it.each([
    '{}',
    '{"tenantMutationsEnabled":"true"}',
    '{"tenantMutationsEnabled":1}',
    '{"tenantMutationsEnabled":null}',
    '{"tenantMutationsEnabled":true,"diagnostic":"SECRET"}',
    'null',
    '[]',
    'true',
    'not-json',
    '{',
    ' '.repeat(1024) + '{"tenantMutationsEnabled":true}',
  ])('rejects malformed, non-exact or oversized readiness: %s', async (body) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    const response = await request(createApp())
      .get('/kubo/access?scope=all')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(502);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).not.toHaveProperty('canMutate');
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
  });

  it.each([400, 401, 403, 404, 409, 413, 503, 500])(
    'keeps upstream %s a sanitized non-success',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('SECRET diagnostic', { status }));
      const response = await request(createApp())
        .get('/kubo/access')
        .set('Authorization', `Bearer ${await token()}`);
      expect(response.status).toBe(status === 500 ? 502 : status);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).not.toHaveProperty('canMutate');
      expect(JSON.stringify(response.body)).not.toContain('SECRET');
    }
  );

  it.each([201, 204])('rejects unexpected successful upstream status %s', async (status) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(status === 204 ? null : '{"tenantMutationsEnabled":true}', { status })
      );
    const response = await request(createApp())
      .get('/kubo/access')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(502);
    expect(response.body).not.toHaveProperty('canMutate');
  });

  it('sanitizes a failed response stream', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('SECRET stream'));
          },
        })
      )
    );
    const response = await request(createApp())
      .get('/kubo/access')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
  });

  it.each([new Error('SECRET network'), new DOMException('SECRET timeout', 'TimeoutError')])(
    'sanitizes transport failures %s',
    async (error) => {
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(error);
      const response = await request(createApp())
        .get('/kubo/access')
        .set('Authorization', `Bearer ${await token()}`);
      expect(response.status).toBe(502);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).not.toHaveProperty('canMutate');
      expect(JSON.stringify(response.body)).not.toContain('SECRET');
    }
  );

  it.each(['invalid', 'all&scope=tenant'])(
    'denies invalid scope before discovery %s',
    async (scope) => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      const response = await request(createApp())
        .get(`/kubo/access?scope=${scope}`)
        .set('Authorization', `Bearer ${await token()}`);
      expect(response.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it('denies unverified operator discovery before transport', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const response = await request(createApp())
      .get('/kubo/access?scope=all')
      .set('Authorization', `Bearer ${await token({ nativeSigner: true })}`);
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('performs fresh discovery and never uses a positive snapshot to admit mutations', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"tenantMutationsEnabled":true}'))
      .mockResolvedValueOnce(new Response('SECRET protection removed', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"tenantMutationsEnabled":false}'));
    const app = createApp();
    const bearer = `Bearer ${await token()}`;
    expect(
      (await request(app).get('/kubo/access').set('Authorization', bearer)).body.canMutate
    ).toBe(true);
    expect(
      (
        await request(app)
          .post('/kubo/stacks/team/product/pause')
          .set('Authorization', bearer)
          .send({ paused: true })
      ).status
    ).toBe(503);
    expect(
      (await request(app).get('/kubo/access').set('Authorization', bearer)).body.canMutate
    ).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
/* eslint-enable unicorn/no-await-expression-member */
