import { jwtVerify } from 'jose';
import request from 'supertest';

import {
  cleanupKuboTest,
  createApp,
  proofKey,
  setupKuboTest,
  token,
} from '#src/test-utils/kubo.js';

const { jest } = import.meta;

const snapshot = { nodes: [{ name: 'node-1', instanceType: 'Standard_D8as_v6' }] };
const priceList = {
  Items: [{ retailPrice: 0.447, productName: 'Virtual Machines D8as v6', meterName: 'D8as v6' }],
};

describe('cluster capacity map access', () => {
  beforeEach(setupKuboTest);
  afterEach(cleanupKuboTest);

  it('lets any tenant read the cluster capacity map', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(snapshot)));
    const response = await request(createApp('tenant-a'))
      .get('/kubo/kshows?scope=tenant')
      .set('Authorization', `Bearer ${await token({ tenantId: 'tenant-a' })}`);
    expect(response.status).toBe(200);
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const proof = new Headers(init?.headers).get('X-Kubo-Console-Context') ?? '';
    const { payload } = await jwtVerify(proof, proofKey, {
      issuer: 'verity-console',
      audience: 'kubo-portal',
    });
    expect(payload).toMatchObject({
      tenantId: 'tenant-a',
      operator: false,
      path: '/api/kshows/snapshot',
    });
  });

  it('keeps the per-node price list operator-only', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).includes('prices.azure.com')
          ? new Response(JSON.stringify(priceList))
          : new Response(JSON.stringify(snapshot))
      );
    const tenant = await request(createApp('tenant-a'))
      .get('/kubo/kshows?scope=tenant')
      .set('Authorization', `Bearer ${await token({ tenantId: 'tenant-a' })}`);
    expect(tenant.status).toBe(200);
    expect(tenant.body.nodes[0].hourlyUSD).toBeUndefined();
    const operator = await request(createApp('tenant-a'))
      .get('/kubo/kshows?scope=all')
      .set('Authorization', `Bearer ${await token({ tenantId: 'tenant-a' })}`);
    expect(operator.status).toBe(200);
    expect(operator.body.nodes[0].hourlyUSD).toBe(0.447);
  });
});
