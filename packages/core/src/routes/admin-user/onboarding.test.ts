import { createMockUtils, pickDefault } from '@logto/shared/esm';

import { mockUser } from '#src/__mocks__/index.js';
import { MockTenant, type Partial2 } from '#src/test-utils/tenant.js';
import { createRequester } from '#src/utils/test-utils.js';

import { type AcsMail, type AcsMailConfig } from '#src/libraries/acs-mail.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';

const { jest } = import.meta;
const { mockEsmWithActual } = createMockUtils(jest);

const insertOneTimeToken = jest.fn(async () => ({ id: 'token-id', token: 'the-token' }));
const deleteOneTimeTokenById = jest.fn(async () => undefined);
const findUsersRolesByUserId = jest.fn(async () => []);
const insertUsersRoles = jest.fn(async () => undefined);
const findRoleById = jest.fn(async () => ({ id: 'admin-role', name: 'admin' }));

const findUserById = jest.fn(async () => mockUser);

const mockedQueries = {
  users: {
    findUserById,
    findUserByEmail: jest.fn(async () => mockUser),
  },
  oneTimeTokens: {
    insertOneTimeToken,
    deleteOneTimeTokenById,
  },
  organizations: {
    findById: jest.fn(async () => ({ id: 't-default', name: 'meshX', branding: {} })),
  },
  usersRoles: {
    findUsersRolesByUserId,
    insertUsersRoles,
  },
  roles: {
    findRoleById,
  },
} as unknown as Partial2<Queries>;

const mockedLibraries = {} as unknown as Partial<Libraries>;

const { sendMail } = await mockEsmWithActual('#src/libraries/acs-mail.js', () => ({
  sendMail: jest.fn(async (_mail: AcsMail, _config: AcsMailConfig) => undefined),
}));

const key = Buffer.from('test-access-key').toString('base64');

const adminUserOnboardingRoutes = await pickDefault(import('./onboarding.js'));

describe('adminUserOnboardingRoutes', () => {
  const tenantContext = new MockTenant(undefined, mockedQueries, undefined, mockedLibraries);
  const userRequest = createRequester({
    authedRoutes: adminUserOnboardingRoutes,
    tenantContext,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ACS_CONNECTION_STRING = `endpoint=https://example.communication.azure.com/;accesskey=${key}`;
    process.env.ACS_SENDER_EMAIL = 'noreply@example.azurecomm.net';
  });

  afterEach(() => {
    delete process.env.ACS_CONNECTION_STRING;
    delete process.env.ACS_SENDER_EMAIL;
  });

  it('sends the onboarding mail and answers with no content', async () => {
    const response = await userRequest.post('/users/foo/onboarding-email');

    expect(response.status).toEqual(204);
    // The mail goes out through the platform's mail service, with the meshX branding.
    expect(sendMail).toHaveBeenCalledTimes(1);

    const [mail] = sendMail.mock.calls[0] ?? [];
    expect(mail?.to).toEqual(mockUser.primaryEmail);
    expect(mail?.subject).toBe('You have been invited to meshX console');
    // The link signs the person in with a one-time token.
    expect(mail?.html).toContain('/one-time-token');
    expect(mail?.html).toContain('one_time_token=the-token');
    expect(mail?.html).toContain('meshX console');
    // The logo travels with the mail, so the client shows it without fetching anything.
    expect(mail?.attachments).toHaveLength(1);
  });

  it('grants the roles the caller picked', async () => {
    const response = await userRequest
      .post('/users/foo/onboarding-email')
      .send({ roleIds: ['admin-role'] });

    expect(response.status).toEqual(204);
    expect(findRoleById).toHaveBeenCalledWith('admin-role');
    expect(insertUsersRoles).toHaveBeenCalledWith([
      expect.objectContaining({ userId: mockUser.id, roleId: 'admin-role' }),
    ]);
  });

  it('refuses when the user has no email address', async () => {
    findUserById.mockResolvedValueOnce({
      ...mockUser,
      primaryEmail: null,
    });

    const response = await userRequest.post('/users/foo/onboarding-email');

    expect(response.status).toEqual(422);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('drops the sign-in token when the mail cannot be sent', async () => {
    sendMail.mockRejectedValueOnce(new Error('ACS is down'));

    const response = await userRequest.post('/users/foo/onboarding-email');

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(deleteOneTimeTokenById).toHaveBeenCalledWith('token-id');
  });
});
