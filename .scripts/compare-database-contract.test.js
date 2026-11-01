import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as comparison from './compare-database.js';

test('checks exact documented bootstrap deltas without ignoring a table', () => {
  assert.equal(typeof comparison.assertDatabaseData, 'function');
  const left = { tenants: [{ name: 'Admin', tag: 'development' }], users: [] };
  const right = { tenants: [{ name: 'Admin', tag: 'production' }], users: [] };
  const expected = {
    tenants: { leftOnly: left.tenants, rightOnly: right.tenants },
  };
  comparison.assertDatabaseData(left, right, expected);
  assert.throws(() => comparison.assertDatabaseData(left, right));
  assert.throws(() =>
    comparison.assertDatabaseData(
      left,
      {
        ...right,
        tenants: [{ name: 'Unexpected tenant', tag: 'production' }],
      },
      expected
    )
  );
  assert.throws(() =>
    comparison.assertDatabaseData(
      left,
      { ...right, users: [{ id: 'extra' }] },
      expected
    )
  );
});

test('rejects stale expectations, missing tables, and changed duplicate row counts', () => {
  assert.equal(typeof comparison.assertDatabaseData, 'function');
  const expected = {
    grants: { leftOnly: [], rightOnly: [{ tenant_id: 'admin' }] },
  };
  comparison.assertDatabaseData(
    { grants: [] },
    { grants: [{ tenant_id: 'admin' }] },
    expected
  );
  assert.throws(() =>
    comparison.assertDatabaseData({ grants: [] }, { grants: [] }, expected)
  );
  assert.throws(() =>
    comparison.assertDatabaseData({ grants: [] }, {}, expected)
  );
  assert.throws(() =>
    comparison.assertDatabaseData(
      { grants: [] },
      {
        grants: [{ tenant_id: 'admin' }, { tenant_id: 'admin' }],
      },
      expected
    )
  );
});

test('equal data still uses strict comparison and rejects unknown expectation tables', () => {
  assert.equal(typeof comparison.assertDatabaseData, 'function');
  comparison.assertDatabaseData({ tenants: [] }, { tenants: [] });
  assert.throws(() =>
    comparison.assertDatabaseData(
      { tenants: [] },
      { tenants: [] },
      {
        unknown: { leftOnly: [], rightOnly: [] },
      }
    )
  );
});

test('normalizes generated organization scope references by tenant and name, not by omission', () => {
  assert.equal(typeof comparison.normalizeOrganizationScopeIds, 'function');
  assert.deepEqual(
    comparison.normalizeOrganizationScopeIds(
      [
        {
          tenant_id: 'admin',
          organization_scope_id: 'random-id',
          organization_role_id: 'admin',
        },
      ],
      [{ tenant_id: 'admin', id: 'random-id', name: 'all' }]
    ),
    [
      {
        tenant_id: 'admin',
        organization_scope_id: 'all',
        organization_role_id: 'admin',
      },
    ]
  );
  assert.throws(() =>
    comparison.normalizeOrganizationScopeIds(
      [{ tenant_id: 'other', organization_scope_id: 'random-id' }],
      [{ tenant_id: 'admin', id: 'random-id', name: 'all' }]
    )
  );
});

test('seed deltas are restricted to the reviewed immutable upstream baseline and direction', () => {
  assert.equal(typeof comparison.selectExpectedDifferences, 'function');
  const commit = '08e3fae4cd138722196d3dddea3e1508bcb47720';
  assert.deepEqual(comparison.selectExpectedDifferences(), {});
  assert.ok(comparison.selectExpectedDifferences('up', 'v1.44.0', commit).tenants);
  assert.ok(comparison.selectExpectedDifferences('down', 'v1.44.0', commit).tenants);
  assert.throws(() => comparison.selectExpectedDifferences('up', 'v9.9.9', commit));
  assert.throws(() =>
    comparison.selectExpectedDifferences('ignore', 'v1.44.0', commit)
  );
  assert.throws(() =>
    comparison.selectExpectedDifferences('up', 'v1.44.0', '0'.repeat(40))
  );
});
