import { type HookEvent, type HookEventPayload } from '@logto/schemas';
import { trySafe } from '@silverhand/essentials';

/** Only standard Incoming Webhooks, not Workflow, Gov, or lookalike endpoints. */
export const isSlackWebhookUrl = (url: string): boolean => {
  const parsed = trySafe(() => new URL(url));
  return Boolean(
    parsed &&
    parsed.protocol === 'https:' &&
    parsed.hostname === 'hooks.slack.com' &&
    !parsed.username &&
    !parsed.password &&
    !parsed.port &&
    !parsed.search &&
    !parsed.hash &&
    /^\/services(?:\/[\w-]+){3}$/.test(parsed.pathname)
  );
};

const actions = {
  PostRegister: 'User registered',
  PostSignIn: 'User signed in',
  PostSignInAdaptiveMfaTriggered: 'Adaptive MFA triggered',
  PostResetPassword: 'User reset password',
  'User.Created': 'User created',
  'User.Deleted': 'User deleted',
  'User.Data.Updated': 'User profile updated',
  'User.SuspensionStatus.Updated': 'User access status changed',
  'TrustedDevice.Created': 'Trusted device created',
  'TrustedDevice.Deleted': 'Trusted device deleted',
  'Role.Created': 'Role created',
  'Role.Deleted': 'Role deleted',
  'Role.Data.Updated': 'Role updated',
  'Role.Scopes.Updated': 'Role permissions updated',
  'Scope.Created': 'Permission created',
  'Scope.Deleted': 'Permission deleted',
  'Scope.Data.Updated': 'Permission updated',
  'Organization.Created': 'Organization created',
  'Organization.Deleted': 'Organization deleted',
  'Organization.Data.Updated': 'Organization updated',
  'Organization.Membership.Updated': 'Organization membership updated',
  'OrganizationRole.Created': 'Organization role created',
  'OrganizationRole.Deleted': 'Organization role deleted',
  'OrganizationRole.Data.Updated': 'Organization role updated',
  'OrganizationRole.Scopes.Updated': 'Organization role permissions updated',
  'OrganizationScope.Created': 'Organization permission created',
  'OrganizationScope.Deleted': 'Organization permission deleted',
  'OrganizationScope.Data.Updated': 'Organization permission updated',
  'Identifier.Lockout': 'Sign-in identifier locked',
  'Message.RateLimited': 'Message rate limit reached',
  'Grant.LimitExceeded': 'Grant limit exceeded',
} satisfies Record<HookEvent, string>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const escapeSlack = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const getAction = (event: string, data: Record<string, unknown>) => {
  if (event === 'User.SuspensionStatus.Updated' && typeof data.isSuspended === 'boolean') {
    return data.isSuspended ? 'User suspended' : 'User access restored';
  }
  return Object.entries(actions).find(([key]) => key === event)?.[1] ?? 'Event notification';
};

const getDetails = (url: string, context: Record<string, unknown>, event: string) => {
  const data = record(context.data);
  const params = record(context.params);
  const user = record(context.user);
  const application = record(context.application);
  const safeText = (...values: unknown[]) => {
    const value = values.find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim())
    );
    return (
      value &&
      redactSlackWebhookSecrets(url, value)
        // Replace control characters rather than forwarding multiline names or hidden controls.
        // eslint-disable-next-line no-control-regex
        .replaceAll(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
        .slice(0, 400)
    );
  };
  const entity = event.split('.')[0];
  const labels: Record<string, string> = {
    User: 'Affected user',
    Organization: 'Organization',
    Role: 'Role',
    Scope: 'Permission',
    OrganizationRole: 'Organization role',
    OrganizationScope: 'Organization permission',
    TrustedDevice: 'Trusted device',
  };
  const interaction = [
    'PostRegister',
    'PostSignIn',
    'PostSignInAdaptiveMfaTriggered',
    'PostResetPassword',
  ].includes(event);
  const subject = interaction
    ? safeText(user.name, user.username, user.id, context.userId)
    : safeText(
        data.name,
        entity === 'User' && data.username,
        data.id,
        entity === 'User' && context.userId,
        entity === 'Organization' && context.organizationId,
        entity === 'User' ? params.userId : entity === 'Scope' ? params.scopeId : params.id
      );
  const label = interaction ? 'User' : Object.entries(labels).find(([key]) => key === entity)?.[1];
  const app = safeText(application.name, application.id, context.applicationId);
  return [
    ...(label ? [`${label}: ${subject ?? 'Not provided'}`] : []),
    ...(app ? [`Application: ${app}`] : []),
  ];
};

const getTime = (context: Record<string, unknown>) => {
  const milliseconds =
    typeof context.createdAt === 'string' && context.createdAt.trim()
      ? Date.parse(context.createdAt)
      : Number.NaN;
  const epoch = Math.floor(milliseconds / 1000);
  // Slack dates require a positive integer epoch; never emit invalid markup.
  const utc =
    Number.isSafeInteger(epoch) && epoch > 0 ? new Date(milliseconds).toISOString() : undefined;
  const when = utc ? `<!date^${epoch}^{date_short_pretty} at {time}|${utc}>` : 'Time unavailable';
  return { utc, when };
};

/** Only explicitly allowlisted subject/application fields leave the generic event payload. */
export const buildWebhookRequestBody = (
  url: string,
  payload: HookEventPayload,
  { isTest = false }: { isTest?: boolean } = {}
) => {
  if (!isSlackWebhookUrl(url)) {
    return payload;
  }
  const context = record(payload);
  const event = typeof context.event === 'string' ? context.event : '';
  const heading = `${isTest ? 'Test notification — ' : ''}${getAction(event, record(context.data))}`;
  const details = getDetails(url, context, event);
  const { utc, when } = getTime(context);

  return {
    text: [heading, ...details, `When: ${utc ?? 'Time unavailable'}`]
      .map((text) => escapeSlack(text))
      .join('\n'),
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: heading, emoji: false } },
      ...details.map((text) => ({
        type: 'section',
        text: { type: 'plain_text', text, emoji: false },
      })),
      { type: 'section', text: { type: 'mrkdwn', text: `When: ${when}` } },
    ],
  };
};

/** Slack diagnostics may echo the URL; never retain its bearer secret in audit/test errors. */
export const redactSlackWebhookSecrets = (url: string, text: string): string => {
  if (!isSlackWebhookUrl(url)) {
    return text;
  }

  const { pathname } = new URL(url);
  const secret = pathname.slice(pathname.lastIndexOf('/') + 1);
  return text.replaceAll(url, '[Slack webhook]').replaceAll(secret, '[redacted]');
};

export const getSlackWebhookError = (status?: number) =>
  status === undefined ? 'Error' : `HTTPError (${status})`;
