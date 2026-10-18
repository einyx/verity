import { describe, expect, it } from 'vitest';

import { challengeRecordName, challengeRecordValue, isDomainChallengeSatisfied } from './dns.js';
import { createInMemoryConsoleSsoStore } from './store.js';
import { addConsoleSsoDomainBodyGuard, createConsoleSsoConnectorBodyGuard } from './types.js';

const connector = (id: string, ownerSub: string) => ({
  id,
  ownerSub,
  provider: 'google' as const,
  displayName: 'Acme Google',
  clientId: 'client-id',
  createdAt: new Date('2026-10-18T00:00:00Z'),
});

describe('console SSO store', () => {
  it('only lets the owner read, change, or delete a connection', async () => {
    const store = createInMemoryConsoleSsoStore();
    await store.createConnector(connector('c1', 'alice'));

    expect(await store.findConnector('bob', 'c1')).toBeUndefined();
    expect(await store.deleteConnector('bob', 'c1')).toBe(false);
    expect(await store.listConnectors('bob')).toEqual([]);
    expect(await store.findConnector('alice', 'c1')).toBeDefined();
  });

  it('refuses to add the same domain twice to one connection', async () => {
    const store = createInMemoryConsoleSsoStore();
    await store.createConnector(connector('c1', 'alice'));

    expect(await store.addDomain('alice', 'c1', 'acme.com', 'token-1')).toEqual({
      domain: 'acme.com',
      token: 'token-1',
      verifiedAt: null,
    });
    expect(await store.addDomain('alice', 'c1', 'acme.com', 'token-2')).toBeUndefined();
  });

  it('counts only the owner’s connections for the plan limit', async () => {
    const store = createInMemoryConsoleSsoStore();
    await store.createConnector(connector('c1', 'alice'));
    await store.createConnector(connector('c2', 'bob'));

    expect(await store.countConnectors('alice')).toBe(1);
  });
});

const resolveSplit = async () => [['meshx-console-sso=', 'abc123']];

describe('domain challenge', () => {
  const token = 'abc123';

  it('names the record under the challenge prefix', () => {
    expect(challengeRecordName('acme.com')).toBe('_meshx-console-sso.acme.com');
    expect(challengeRecordValue(token)).toBe('meshx-console-sso=abc123');
  });

  it('is satisfied when the expected TXT value is published, even split into chunks', async () => {
    expect(await isDomainChallengeSatisfied('acme.com', token, resolveSplit)).toBe(true);
  });

  it('is not satisfied for a wrong token or a failed lookup', async () => {
    expect(
      await isDomainChallengeSatisfied('acme.com', token, async () => [['meshx-console-sso=other']])
    ).toBe(false);
    expect(
      await isDomainChallengeSatisfied('acme.com', token, async () => {
        throw new Error('NXDOMAIN');
      })
    ).toBe(false);
  });
});

describe('request guards', () => {
  it('accepts plain hostnames and rejects anything else as a domain', () => {
    expect(addConsoleSsoDomainBodyGuard.safeParse({ domain: 'acme.com' }).success).toBe(true);
    expect(addConsoleSsoDomainBodyGuard.safeParse({ domain: 'https://acme.com' }).success).toBe(
      false
    );
    expect(addConsoleSsoDomainBodyGuard.safeParse({ domain: 'acme' }).success).toBe(false);
  });

  it('only accepts supported providers', () => {
    const body = { displayName: 'Acme', clientId: 'id', clientSecret: 'secret' };

    expect(
      createConsoleSsoConnectorBodyGuard.safeParse({ ...body, provider: 'google' }).success
    ).toBe(true);
    expect(
      createConsoleSsoConnectorBodyGuard.safeParse({ ...body, provider: 'okta' }).success
    ).toBe(false);
  });
});
