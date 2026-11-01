import { TenantScope } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);
const pool = { maybeOne: jest.fn(), any: jest.fn(), one: jest.fn() };
const isAdminTenantOperator = jest.fn();
const tenant = {
  queries: { tenantUsage: { getSelfComputedUsageByKey: jest.fn(async () => 7) }, pool },
  connectors: {
    getLogtoConnectors: jest.fn(async () => [
      { type: 'Social' },
      { type: 'Social' },
      { type: 'Email' },
    ]),
  },
};
mockEsm('#src/env-set/index.js', () => ({ EnvSet: { sharedPool: Promise.resolve(pool) } }));
mockEsm('#src/routes/cloud-tenant-access.js', () => ({ isAdminTenantOperator }));
mockEsm('#src/tenants/tenant-lookup.js', () => ({ getTenantForUsage: async () => tenant }));

const { createCloudConsoleHost } = await import('./cloud-console-host.js');

beforeEach(() => {
  jest.clearAllMocks();
  isAdminTenantOperator.mockResolvedValue(false);
  pool.maybeOne.mockReset();
  pool.any.mockResolvedValue([]);
  pool.one.mockResolvedValue({ count: 4 });
});

it('requires a real active user account rather than treating any signed subject as a person', async () => {
  const host = createCloudConsoleHost();
  expect(await host.hasUser('machine-client')).toBe(false);
  pool.maybeOne.mockResolvedValueOnce({ id: 'member-user' });
  expect(await host.hasUser('member-user')).toBe(true);
});

it('reads actual organization scopes without granting write access to a viewer', async () => {
  pool.any.mockResolvedValueOnce([
    { name: TenantScope.ReadData },
    { name: TenantScope.ReadMember },
  ]);
  expect(await createCloudConsoleHost().memberScopes('viewer', 'tenant-one', 'viewer')).toEqual([
    { name: TenantScope.ReadData },
    { name: TenantScope.ReadMember },
  ]);
});

it('does not expose another member scopes without read-member permission', async () => {
  pool.any.mockResolvedValueOnce([{ name: TenantScope.ReadData }]);
  expect(
    await createCloudConsoleHost().memberScopes('viewer', 'tenant-one', 'another-user')
  ).toBeUndefined();
});

it('does not grant scopes outside an existing tenant membership', async () => {
  expect(
    await createCloudConsoleHost().memberScopes('outsider', 'tenant-one', 'outsider')
  ).toBeUndefined();
});

it('recognizes the existing global operator role, but not nonexistent tenants', async () => {
  isAdminTenantOperator.mockResolvedValue(true);
  const host = createCloudConsoleHost();
  expect(await host.memberScopes('operator', 'missing-tenant', 'operator')).toBeUndefined();
  pool.maybeOne.mockResolvedValue({ id: 'admin' });
  expect(await host.memberScopes('operator', 'admin', 'operator')).toEqual(
    expect.arrayContaining([{ name: TenantScope.WriteData }])
  );
});

it('binds invitation queries to the authenticated user using a SQL parameter', async () => {
  const user = "member' OR true --";
  const invitations = [
    {
      id: 'invitation-one',
      organizationId: 't-tenant-one',
      tenantName: 'Tenant one',
      tenantTag: 'development',
    },
  ];
  pool.any.mockResolvedValueOnce(invitations);
  expect(await createCloudConsoleHost().invitations(user)).toEqual(invitations);
  const query = pool.any.mock.calls[0]?.[0] as { sql: string; values: unknown[] };
  expect(query.sql).not.toContain(user);
  expect(query.values).toContain(user);
});

it('returns measured entity usage, social connectors, member count and scope counts', async () => {
  pool.any
    .mockResolvedValueOnce([{ id: 'resource-one', count: 3 }])
    .mockResolvedValueOnce([{ id: 'role-one', count: 2 }]);
  const value = await createCloudConsoleHost().usage('tenant-one');
  expect(value.usage.applicationsLimit).toBe(7);
  expect(value.usage.socialConnectorsLimit).toBe(2);
  expect(value.usage.tenantMembersLimit).toBe(4);
  expect(value.resources).toEqual({ 'resource-one': 3 });
  expect(value.roles).toEqual({ 'role-one': 2 });
});
