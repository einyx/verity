import { type HookEvent, type HookEventPayload } from '@logto/schemas';
import { trySafe, yes } from '@silverhand/essentials';
import { UAParser } from 'ua-parser-js';

import { getHookDataSubject } from './data-subject.js';

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

const getEntitySubjectIds = (entity: string | undefined, context: Record<string, unknown>) => {
  const params = record(context.params);
  switch (entity) {
    case 'User': {
      return [context.userId, params.userId];
    }
    case 'Organization': {
      return [context.organizationId, params.id];
    }
    case 'OrganizationRole': {
      return [context.organizationRoleId, params.id];
    }
    case 'Scope': {
      return [params.scopeId];
    }
    default: {
      return [params.id];
    }
  }
};

const getDetails = (url: string, context: Record<string, unknown>, event: string) => {
  const data = getHookDataSubject(context.data) ?? {};
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
        ...getEntitySubjectIds(entity, context)
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

const hasSecurityContext = (context: Record<string, unknown>) => {
  // Detailed Slack security notifications remain gated and require explicit
  // per-hook consent; enabling development features alone must not reveal PII.
  const isDevFeaturesEnabled =
    process.env.NODE_ENV !== 'production' || yes(process.env.DEV_FEATURES_ENABLED);
  const approvedHooks = (process.env.SLACK_SECURITY_NOTIFICATION_HOOK_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    isDevFeaturesEnabled &&
    typeof context.hookId === 'string' &&
    approvedHooks.includes(context.hookId)
  );
};

/** Mask address-shaped display text conservatively, including surrounding colons. */
const redactIpLiterals = (value: string) =>
  value.replaceAll(
    /(?:\d{1,3}\.){3}\d{1,3}|(?:[\da-f]*:){2,}[\d.:a-f]*(?:%[\w.-]+)?/gi,
    '[IP omitted]'
  );

const optionalDetail = (label: string, value: unknown) =>
  typeof value === 'string' && value ? [`${label}: ${value}`] : [];

const getBrowserDetails = (userAgent: unknown) => {
  if (typeof userAgent !== 'string') {
    return [];
  }
  const parsed = trySafe(() => {
    const parser = new UAParser(userAgent.slice(0, 1024));
    // UAParser results are thenable; return plain strings so trySafe does not
    // mistake the parser's result object for a Promise.
    return { browser: parser.getBrowser().name, os: parser.getOS().name };
  });
  const browser = parsed?.browser;
  const os = parsed?.os;
  if (browser === undefined && os === undefined) {
    return [];
  }
  return [`Browser/OS: ${browser ?? 'Unknown'} / ${os ?? 'Unknown'}`];
};

const getSecurityDetails = (url: string, context: Record<string, unknown>, event: string) => {
  const safeText = (...values: unknown[]) => {
    const value = values.find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim())
    );
    return (
      value &&
      redactSlackWebhookSecrets(url, value)
        // Keep user-controlled strings bounded and on one line in Slack.
        // eslint-disable-next-line no-control-regex
        .replaceAll(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
        .slice(0, 254)
    );
  };
  const interaction = [
    'PostRegister',
    'PostSignIn',
    'PostSignInAdaptiveMfaTriggered',
    'PostResetPassword',
  ].includes(event);
  const user = record(context.user);
  const application = record(context.application);
  // Mutation data needs process-local provenance; never treat arbitrary custom
  // data or the mutation's affected user as the authenticated actor.
  const subject = getHookDataSubject(context.data) ?? {};
  const userId = interaction && safeText(context.userId, user.id);
  const email = interaction && safeText(user.primaryEmail);
  const targetId =
    !interaction && safeText(subject.id, ...getEntitySubjectIds(event.split('.')[0], context));
  const applicationId = safeText(application.id, context.applicationId);
  const hookId = safeText(context.hookId);
  return [
    `Event: ${Object.keys(actions).includes(event) ? event : 'Not provided'}`,
    ...(interaction ? [] : ['Actor: Not provided']),
    ...optionalDetail('User ID', userId),
    ...optionalDetail('Email', email),
    ...optionalDetail('Affected entity ID', targetId),
    ...optionalDetail('Application ID', applicationId),
    ...getBrowserDetails(context.userAgent),
    ...optionalDetail('Webhook ID', hookId),
  ];
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
  const heading = `${isTest ? 'Test notification — ' : ''}${getAction(event, getHookDataSubject(context.data) ?? {})}`;
  const securityContext = hasSecurityContext(context);
  const details = securityContext
    ? [...getDetails(url, context, event), ...getSecurityDetails(url, context, event)].map(
        (detail) => redactIpLiterals(detail)
      )
    : getDetails(url, context, event);
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
    ...(securityContext && { unfurl_links: false, unfurl_media: false }),
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
