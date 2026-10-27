import { createMockUtils, pickDefault } from '@logto/shared/esm';

import { mockUser } from '#src/__mocks__/index.js';
import { MockTenant, type Partial2 } from '#src/test-utils/tenant.js';
import { createRequester } from '#src/utils/test-utils.js';

import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';

const { jest } = import.meta;
const { mockEsmWithActual } = createMockUtils(jest);

const insertOneTimeToken = jest.fn(async () => ({ id: 'token-id', token: 'the-token' }));
const deleteOneTimeTokenById = jest.fn(async () => undefined);
const findUsersRolesByUserId = jest.fn(async () => []);
const insertUsersRoles = jest.fn(async () => undefined);
const findRoleById = jest.fn(async () => ({ id: 'admin-role', name: 'admin' }));
const sendEmail = jest.fn(async (_to: string, _payload: unknown) => undefined);

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

const mockedLibraries = {
  organizationInvitations: {
    sendEmail,
  },
} as unknown as Partial<Libraries>;

const { sendMail } = await mockEsmWithActual('#src/libraries/acs-mail.js', () => ({
  sendMail: jest.fn(async () => undefined),
}));

const adminUserOnboardingRoutes = await pickDefault(import('./onboarding.js'));

describe('adminUserOnboardingRoutes', () => {
  const tenantContext = new MockTenant(undefined, mockedQueries, undefined, mockedLibraries);
  const userRequest = createRequester({
    authedRoutes: adminUserOnboardingRoutes,
    tenantContext,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends the onboarding mail and answers with no content', async () => {
    const response = await userRequest.post('/users/foo/onboarding-email');

    expect(response.status).toEqual(204);
    // The mail goes out through the tenant's own email connector.
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const [to, payload] = sendEmail.mock.calls[0] ?? [];
    expect(to).toEqual(mockUser.primaryEmail);
    // The link signs the person in with a one-time token.
    expect(JSON.stringify(payload)).toContain('/one-time-token');
    expect(JSON.stringify(payload)).toContain('one_time_token=the-token');
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
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('drops the sign-in token when the mail cannot be sent', async () => {
    sendEmail.mockRejectedValueOnce(new Error('no connector'));

    const response = await userRequest.post('/users/foo/onboarding-email');

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(deleteOneTimeTokenById).toHaveBeenCalledWith('token-id');
  });
});
