/* eslint-disable unicorn/no-await-expression-member -- Keep signed HTTP assertions local to each security regression. */
import { readOnlyAccessHeader } from '@logto/schemas';
import { jwtVerify } from 'jose';
import Sinon from 'sinon';
import request from 'supertest';

import { EnvSet } from '#src/env-set/index.js';
import {
  createApp,
  token,
  proofKey,
  maybeOne,
  setupKuboTest,
  cleanupKuboTest,
} from '#src/test-utils/kubo.js';

import { callLogtoTool, logtoMcpTools } from './mcp-logto-tools.js';

const { jest } = import.meta;

describe('signed Kubo caller isolation', () => {
  beforeEach(setupKuboTest);
  afterEach(cleanupKuboTest);

  it('requires a bearer before any upstream request', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    expect((await request(createApp()).get('/kubo/stacks')).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['tenant-a', 'tenant-b'])(
    'delegates selected %s, not incoming ownership or proof',
    async (tenantId) => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
      const response = await request(createApp(tenantId))
        .get('/kubo/stacks?tenantId=foreign')
        .set('Authorization', `Bearer ${await token({ tenantId })}`)
        .set('X-Kubo-Console-Context', 'forged');
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const [, init] = fetchSpy.mock.calls[0] ?? [];
      const proof = new Headers(init?.headers).get('X-Kubo-Console-Context') ?? '';
      const { payload } = await jwtVerify(proof, proofKey, {
        issuer: 'verity-console',
        audience: 'kubo-portal',
      });
      expect(payload).toMatchObject({
        tenantId,
        sub: 'operator',
        operator: false,
        method: 'GET',
        path: '/api/stacks',
      });
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
    }
  );

  it.each([
    { nativeSigner: true, issuer: 'https://native.example/oidc' },
    { nativeSigner: true },
    { machine: true },
  ])('rejects native/colliding/forged-admin/machine operator: %j', async (options) => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    expect(
      (
        await request(createApp())
          .get('/kubo/stacks?scope=all')
          .set('Authorization', `Bearer ${await token(options)}`)
      ).status
    ).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires an active global operator for explicit all scope', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    maybeOne.mockImplementation(async (query: { sql: string }) =>
      query.sql.includes('is_suspended') ? { isSuspended: true } : { userId: 'operator' }
    );
    expect(
      (
        await request(createApp())
          .get('/kubo/stacks?scope=all')
          .set('Authorization', `Bearer ${await token()}`)
      ).status
    ).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('permits verified active operators only with explicit scope', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    expect(
      (
        await request(createApp())
          .get('/kubo/stacks?scope=all')
          .set('Authorization', `Bearer ${await token()}`)
      ).status
    ).toBe(200);
    const proof =
      new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('X-Kubo-Console-Context') ?? '';
    expect((await jwtVerify(proof, proofKey)).payload.operator).toBe(true);
  });

  it.each([
    '/kubo/cluster/economics',
    '/kubo/kshows',
    '/kubo/agentfw/sessions',
    '/kubo/demorequests',
  ])('rejects scoped aggregate %s', async (path) => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    expect(
      (
        await request(createApp())
          .get(path)
          .set('Authorization', `Bearer ${await token()}`)
      ).status
    ).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 409, 503])(
    'preserves upstream %s without leaking diagnostics',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('SECRET raw payload', { status }));
      const response = await request(createApp())
        .get('/kubo/stacks/foreign/product')
        .set('Authorization', `Bearer ${await token()}`);
      expect(response.status).toBe(status);
      expect(JSON.stringify(response.body)).not.toContain('SECRET');
    }
  );

  it('fails closed without the signing key', async () => {
    Reflect.deleteProperty(process.env, 'KUBO_CONSOLE_PROXY_KEY');
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    expect(
      (
        await request(createApp())
          .get('/kubo/stacks')
          .set('Authorization', `Bearer ${await token()}`)
      ).status
    ).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retains read-only write protection for operators', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    expect(
      (
        await request(createApp())
          .delete('/kubo/stacks/team/product?scope=all')
          .set('Authorization', `Bearer ${await token()}`)
          .set(readOnlyAccessHeader, 'true')
      ).status
    ).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports capabilities without advertising policy-enabled tenant mutations', async () => {
    const response = await request(createApp())
      .get('/kubo/access')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      canViewAll: true,
      operator: false,
      tenantScoped: true,
      canMutate: false,
      tenantMutationsEnabled: false,
    });
  });

  it('signs create bytes with server owner distinct from namespace slug', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }));
    expect(
      (
        await request(createApp())
          .post('/kubo/stacks')
          .set('Authorization', `Bearer ${await token()}`)
          .send({
            template: 'lite',
            tenant: 'new-namespace',
            mode: 'Direct',
            authProvider: 'logto',
          })
      ).status
    ).toBe(201);
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ tenant: 'new-namespace' });
    const proof = new Headers(init?.headers).get('X-Kubo-Console-Context') ?? '';
    expect((await jwtVerify(proof, proofKey)).payload).toMatchObject({
      tenantId: 'tenant-a',
      method: 'POST',
      path: '/api/stacks',
    });
  });

  it.each([
    { template: 'lite', tenant: 'new', consoleTenantId: 'foreign' },
    { template: 'lite', tenant: 'new', operators: {} },
    { template: 'custom', tenant: 'new' },
    { template: 'lite', tenant: 'new', mode: 'Flux' },
  ])('rejects unsafe or submitted-owner creates: %j', async (body) => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    expect(
      (
        await request(createApp())
          .post('/kubo/stacks')
          .set('Authorization', `Bearer ${await token()}`)
          .send(body)
      ).status
    ).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'Direct' },
    { featureFlags: { BAD: 'true' } },
    { featureFlags: { good: 'yes' } },
    { consoleTenantId: 'foreign' },
  ])('rejects unsupported tenant patch %j', async (body) => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    expect(
      (
        await request(createApp())
          .patch('/kubo/stacks/team/product')
          .set('Authorization', `Bearer ${await token()}`)
          .send(body)
      ).status
    ).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retains backend ownership, preview and policy failures without claiming success', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('foreign', { status: 404 }))
      .mockResolvedValueOnce(new Response('policy unavailable', { status: 503 }));
    const app = createApp();
    const bearer = `Bearer ${await token()}`;
    expect(
      (
        await request(app)
          .get('/kubo/template?template=lite&tenant=foreign')
          .set('Authorization', bearer)
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch('/kubo/stacks/team/product')
          .set('Authorization', bearer)
          .send({ featureFlags: { demo: 'true' } })
      ).status
    ).toBe(503);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      '/api/template?template=lite&tenant=foreign'
    );
  });

  it('parses and signs the pause action JSON instead of silently dropping it', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"paused":true}'));
    const response = await request(createApp())
      .post('/kubo/stacks/team/product/pause')
      .set('Authorization', `Bearer ${await token()}`)
      .send({ paused: true });
    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe('{"paused":true}');
  });

  it('uses the same tenant Management API and signed enforcement for MCP stacks', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    const app = createApp();
    const tool = logtoMcpTools.find(({ name }) => name === 'list_foundation_stacks');
    if (!tool) {
      throw new Error('Missing stack tool');
    }
    const result = await callLogtoTool(
      tool,
      {},
      await token(),
      'https://tenant-a.example/api',
      async (url, init) => {
        expect(String(url)).toBe('https://tenant-a.example/api/kubo/stacks');
        const response = await request(app)
          .get('/kubo/stacks')
          .set('Authorization', new Headers(init?.headers).get('authorization') ?? '');
        return new Response(JSON.stringify(response.body), { status: response.status });
      }
    );
    expect(result.isError).toBe(false);
    const proof =
      new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('X-Kubo-Console-Context') ?? '';
    expect((await jwtVerify(proof, proofKey)).payload).toMatchObject({
      tenantId: 'tenant-a',
      operator: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid', 'all&scope=tenant'])('refuses malformed explicit scope %s', async (scope) => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const response = await request(createApp())
      .get(`/kubo/stacks?scope=${scope}`)
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([null, { isSuspended: true }])(
    'does not recognize missing or suspended admin identity %j',
    async (user) => {
      maybeOne.mockImplementation(async (query: { sql: string }) =>
        query.sql.includes('is_suspended') ? user : { userId: 'operator' }
      );
      const response = await request(createApp())
        .get('/kubo/access')
        .set('Authorization', `Bearer ${await token()}`);
      expect(response.body.canViewAll).toBe(false);
    }
  );

  it('does not promote an active user without the global admin role', async () => {
    maybeOne.mockImplementation(async (query: { sql: string }) =>
      query.sql.includes('users_roles') ? null : { isSuspended: false }
    );
    const response = await request(createApp())
      .get('/kubo/stacks?scope=all')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(403);
  });

  it('rejects tenant A organization bearer on tenant B', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const response = await request(createApp('tenant-b'))
      .get('/kubo/stacks')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps authenticated machine tokens tenant-scoped', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    const response = await request(createApp())
      .get('/kubo/stacks')
      .set('Authorization', `Bearer ${await token({ machine: true })}`);
    expect(response.status).toBe(200);
    const proof =
      new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('X-Kubo-Console-Context') ?? '';
    expect((await jwtVerify(proof, proofKey)).payload).toMatchObject({
      tenantId: 'tenant-a',
      operator: false,
    });
  });

  it('does not treat a development-header bypass as signed console identity', async () => {
    Sinon.restore();
    Sinon.stub(EnvSet, 'values').value({
      ...EnvSet.values,
      isProduction: false,
      isIntegrationTest: true,
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const response = await request(createApp())
      .get('/kubo/stacks?scope=all')
      .set('development-user-id', 'operator');
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('denies scoped demo approval before contacting Kubo', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const response = await request(createApp())
      .post('/kubo/demorequests/demo/approve')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns transport failures into sanitized upstream failures', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('SECRET upstream credentials'));
    const response = await request(createApp())
      .get('/kubo/stacks')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
  });

  it('does not turn malformed successful upstream JSON into a successful empty response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not-json'));
    const response = await request(createApp())
      .get('/kubo/stacks')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(502);
  });

  it('bounds upstream chunked responses', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('x'.repeat(5 * 1024 * 1024 + 1)));
    const response = await request(createApp())
      .get('/kubo/stacks')
      .set('Authorization', `Bearer ${await token()}`);
    expect(response.status).toBe(502);
  });

  it('preserves operator airgap success envelope without leaking upstream errors', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('stored demo\n', { status: 201 }));
    const response = await request(createApp())
      .post('/kubo/airgap/bundle?name=demo&scope=all')
      .set('Authorization', `Bearer ${await token()}`)
      .set('Content-Type', 'application/x-tar')
      .send('tar-test-data');
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: 'stored demo\n' });
  });
});
/* eslint-enable unicorn/no-await-expression-member */
