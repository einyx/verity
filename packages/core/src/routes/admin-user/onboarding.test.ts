import { createMockUtils, pickDefault } from '@logto/shared/esm';

import { mockUser } from '#src/__mocks__/index.js';
import { MockTenant, type Partial2 } from '#src/test-utils/tenant.js';
import { createRequester } from '#src/utils/test-utils.js';

import type { AcsMail, AcsMailConfig } from '#src/libraries/acs-mail.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';

const { jest } = import.meta;
const { mockEsmWithActual } = createMockUtils(jest);

const key = Buffer.from('test-access-key').toString('base64');

const insertOneTimeToken = jest.fn(async () => ({ id: 'token-id', token: 'the-token' }));
const deleteOneTimeTokenById = jest.fn(async () => undefined);
const revokeActiveOneTimeTokensByEmail = jest.fn(async () => undefined);
const deleteInvitationById = jest.fn(async () => undefined);
const insertInvitation = jest.fn(async () => ({ id: 'invitation-id' }));

const findUserById = jest.fn(async () => mockUser);

const mockedQueries = {
  users: {
    findUserById,
    findUserByEmail: jest.fn(async () => mockUser),
  },
  oneTimeTokens: {
    insertOneTimeToken,
    deleteOneTimeTokenById,
    revokeActiveOneTimeTokensByEmail,
  },
  organizations: {
    invitations: {
      deleteById: deleteInvitationById,
    },
  },
} as unknown as Partial2<Queries>;

const mockedLibraries = {
  organizationInvitations: {
    insert: insertInvitation,
    getOrganizationInvitationTemplateContext: jest.fn(async () => ({
      organization: { id: 'organization-id', name: 'meshX', branding: {} },
      inviter: {
        id: 'inviter-id',
        name: 'Alessio',
        username: 'alessio',
        primaryEmail: 'alessio@meshx.io',
      },
    })),
  },
} as unknown as Partial<Libraries>;

const { sendMail } = await mockEsmWithActual('#src/libraries/acs-mail.js', () => ({
  sendMail: jest.fn(async (_mail: AcsMail, _config: AcsMailConfig) => undefined),
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
    expect(sendMail).toHaveBeenCalledTimes(1);

    const [mail] = sendMail.mock.calls[0] ?? [];
    expect(mail?.to).toEqual(mockUser.primaryEmail?.toLowerCase());
    expect(mail?.text).toContain('meshX');
    expect(mail?.text).toContain('Alessio');
    expect(mail?.text).toContain('/console/accept/invitation-id');
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

  it('drops the invitation when the mail cannot be sent', async () => {
    sendMail.mockRejectedValueOnce(new Error('ACS returned 500'));

    const response = await userRequest.post('/users/foo/onboarding-email');

    expect(response.status).toEqual(500);
    expect(deleteInvitationById).toHaveBeenCalledWith('invitation-id');
    expect(deleteOneTimeTokenById).toHaveBeenCalledWith('token-id');
  });
});
