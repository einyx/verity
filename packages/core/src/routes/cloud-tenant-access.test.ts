import { type CommonQueryMethods } from '@silverhand/slonik';

import { canManageTenants, tenantAccessPolicyBody } from './cloud-tenant-access.js';

const { jest } = import.meta;

const poolWith = (...answers: unknown[]) => {
  const maybeOne = jest.fn<Promise<unknown>, unknown[]>();
  for (const answer of answers) {
    maybeOne.mockResolvedValueOnce(answer);
  }

  return { maybeOne, query: jest.fn() } as unknown as CommonQueryMethods;
};

describe('canManageTenants', () => {
  it('allows an operator of the admin tenant', async () => {
    const pool = poolWith({ userId: 'operator' });

    await expect(canManageTenants(pool, 'operator')).resolves.toBe(true);
  });

  it('allows a user on the default meshx.io domain when no list is saved', async () => {
    const pool = poolWith(undefined, { primaryEmail: 'ada@meshx.io' });

    await expect(canManageTenants(pool, 'ada')).resolves.toBe(true);
  });

  it('refuses a user on another domain', async () => {
    const pool = poolWith(undefined, { primaryEmail: 'ada@example.com' });

    await expect(canManageTenants(pool, 'ada')).resolves.toBe(false);
  });

  it('uses the saved list, not the default', async () => {
    const pool = poolWith(
      undefined,
      { primaryEmail: 'ada@partner.io' },
      { value: { domains: ['partner.io'] } }
    );

    await expect(canManageTenants(pool, 'ada')).resolves.toBe(true);
  });

  it('refuses a user with no email on record', async () => {
    const pool = poolWith(undefined, { primaryEmail: null });

    await expect(canManageTenants(pool, 'ada')).resolves.toBe(false);
  });
});

describe('tenantAccessPolicyBody', () => {
  it('lowercases and trims domains', () => {
    expect(tenantAccessPolicyBody.parse({ domains: [' MeshX.IO '] })).toEqual({
      domains: ['meshx.io'],
    });
  });

  it('rejects an empty list, a bare word, and a URL', () => {
    expect(() => tenantAccessPolicyBody.parse({ domains: [] })).toThrow();
    expect(() => tenantAccessPolicyBody.parse({ domains: ['meshx'] })).toThrow();
    expect(() => tenantAccessPolicyBody.parse({ domains: ['https://meshx.io'] })).toThrow();
  });
});
