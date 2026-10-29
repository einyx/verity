const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');

function claims(changes = {}, userChanges = {}) {
  const script = readFileSync(join(__dirname, '../scripts/foundation-viewer-claims.js'), 'utf8');
  return JSON.parse(JSON.stringify(runInNewContext(`${script}\ngetCustomJwtClaims(input)`, {
    input: {
      token: { kind: 'AccessToken', accountId: 'viewer', aud: 'https://demo.meshx.foundation/', ...changes },
      context: { user: { id: 'viewer', primaryEmail: 'viewer@example.invalid', isSuspended: false, ...userChanges } },
    },
  })));
}

test('Foundation viewer receives standard signed email claims', () => {
  assert.deepEqual(claims(), { email: 'viewer@example.invalid', email_verified: true });
  assert.deepEqual(claims({ aud: ['https://demo.meshx.foundation/'] }), claims());
});

test('other audiences and machine identities receive no email claims', () => {
  for (const token of [
    { aud: 'https://other.example/' },
    { aud: ['https://other.example/'] },
    { aud: 'https://demo.meshx.foundation/evil' },
    { kind: 'ClientCredentials' },
    { accountId: 'other-user' },
    { accountId: undefined },
  ]) assert.deepEqual(claims(token), {});
});

test('missing primary email and suspended accounts are not marked verified', () => {
  for (const user of [{ primaryEmail: null }, { primaryEmail: '' }, { primaryEmail: 123 }, { isSuspended: true }]) {
    assert.deepEqual(claims({}, user), {});
  }
});
