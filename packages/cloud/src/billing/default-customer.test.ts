import { describe, expect, it } from 'vitest';

import { createInMemoryBillingStore } from './store.js';

const issuer = 'https://auth.example.test/oidc';
const alice = { issuer, sub: 'alice' };
const bob = { issuer, sub: 'bob' };

describe('default Stripe customer per user', () => {
  it('starts empty and remembers the customer a user picked, per user', async () => {
    const store = createInMemoryBillingStore();

    expect(await store.findDefaultCustomerId(alice)).toBeNull();

    await store.setDefaultCustomerId(alice, 'cus_a');

    expect(await store.findDefaultCustomerId(alice)).toBe('cus_a');
    expect(await store.findDefaultCustomerId(bob)).toBeNull();
  });
});
