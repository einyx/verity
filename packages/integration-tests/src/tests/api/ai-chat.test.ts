import { adminTenantId } from '@logto/schemas';
import ky from 'ky';

import api, { authedAdminApi } from '#src/api/api.js';
import { logtoOidcUrl } from '#src/constants.js';
import { devFeatureTest, generateTestName } from '#src/utils.js';

type Proposal = { id: string; tool: string; body: Record<string, unknown>; expiresAt: string };
type Organization = { id: string; name: string };

/**
 * A real Management API token, from a throwaway machine-to-machine app that holds the admin
 * Management API role. Every request in this suite is sent with it, so the server validates the
 * token instead of trusting a development header.
 */
const adminM2mApp = { id: '', token: '' };

// The built-in role that grants the admin tenant's Management API.
const adminManagementApiRoleId = 'm-admin';

const createAdminM2mToken = async () => {
  const app = await authedAdminApi
    .post('applications', { json: { name: generateTestName(), type: 'MachineToMachine' } })
    .json<{ id: string }>();
  // eslint-disable-next-line @silverhand/fp/no-mutation -- The suite caches its M2M app for all cases and deletes it afterward.
  adminM2mApp.id = app.id;

  await authedAdminApi.post(`applications/${app.id}/roles`, {
    json: { roleIds: [adminManagementApiRoleId] },
  });

  const [secret] = await authedAdminApi
    .get(`applications/${app.id}/secrets`)
    .json<Array<{ value: string }>>();
  const credentials = Buffer.from(`${app.id}:${secret?.value ?? ''}`).toString('base64');

  const token = await ky
    .post(`${logtoOidcUrl}/token`, {
      headers: { authorization: `Basic ${credentials}` },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        // The admin tenant's own Management API, which is what the admin port serves.
        resource: `https://${adminTenantId}.meshx.foundation/api`,
        scope: 'all',
      }),
    })
    .json<{ access_token: string }>();

  // eslint-disable-next-line @silverhand/fp/no-mutation -- The token is cached for the suite's requests.
  adminM2mApp.token = token.access_token;
};

// Requests use the real token. Only the setup and cleanup above use the development header.
const tokenApi = api.extend({
  hooks: {
    beforeRequest: [
      (request) => {
        request.headers.set('authorization', `Bearer ${adminM2mApp.token}`);
      },
    ],
  },
});

const propose = async (name: string) => {
  const response = await tokenApi.post('ai-chat/actions', {
    json: { tool: 'create_organization', arguments: { name } },
  });

  return response.json<Proposal>();
};

const listOrganizationsNamed = async (name: string) => {
  const organizations = await tokenApi.get('organizations').json<Organization[]>();

  return organizations.filter((organization) => organization.name === name);
};

/** Deletes any organization this test created, so reruns start clean. */
const removeOrganizationsNamed = async (name: string) => {
  const matches = await listOrganizationsNamed(name);

  await Promise.all(matches.map(async ({ id }) => tokenApi.delete(`organizations/${id}`)));
};

/**
 * Covers the propose, confirm, and cancel flow of Ask AI writes against a running tenant. Nothing
 * is created until the user confirms, and a confirmed write runs exactly once.
 */
devFeatureTest.describe('Ask AI write confirmation', () => {
  beforeAll(async () => {
    await createAdminM2mToken();
  });

  afterAll(async () => {
    if (adminM2mApp.id) {
      await authedAdminApi.delete(`applications/${adminM2mApp.id}`);
    }
  });

  it('proposes a write without creating it', async () => {
    const name = generateTestName();
    const proposal = await propose(name);

    expect(proposal).toMatchObject({ tool: 'create_organization', body: { name } });
    expect(await listOrganizationsNamed(name)).toHaveLength(0);

    await tokenApi.post(`ai-chat/actions/${proposal.id}/cancel`);
  });

  it('creates the organization only after the user confirms it', async () => {
    const name = generateTestName();
    const proposal = await propose(name);

    const confirmed = await tokenApi.post(`ai-chat/actions/${proposal.id}/confirm`, {
      throwHttpErrors: false,
    });

    expect(confirmed.status).toBe(200);
    expect(await listOrganizationsNamed(name)).toHaveLength(1);

    await removeOrganizationsNamed(name);
  });

  it('runs a confirmed write only once', async () => {
    const name = generateTestName();
    const proposal = await propose(name);

    await tokenApi.post(`ai-chat/actions/${proposal.id}/confirm`);

    const replay = await tokenApi.post(`ai-chat/actions/${proposal.id}/confirm`, {
      throwHttpErrors: false,
    });

    expect(replay.status).toBe(409);
    expect(await listOrganizationsNamed(name)).toHaveLength(1);

    await removeOrganizationsNamed(name);
  });

  it('does not create a write that was cancelled', async () => {
    const name = generateTestName();
    const proposal = await propose(name);

    const cancelled = await tokenApi.post(`ai-chat/actions/${proposal.id}/cancel`);

    expect(cancelled.status).toBe(200);

    const confirm = await tokenApi.post(`ai-chat/actions/${proposal.id}/confirm`, {
      throwHttpErrors: false,
    });

    expect(confirm.status).toBe(409);
    expect(await listOrganizationsNamed(name)).toHaveLength(0);
  });

  it('refuses to propose a read tool as a write', async () => {
    const response = await tokenApi.post('ai-chat/actions', {
      json: { tool: 'list_users', arguments: {} },
      throwHttpErrors: false,
    });

    expect(response.status).toBe(400);
  });

  it('refuses to confirm an action id that does not exist', async () => {
    const response = await tokenApi.post('ai-chat/actions/does-not-exist/confirm', {
      throwHttpErrors: false,
    });

    expect(response.status).toBe(404);
  });
});
