import type { HookEventPayload } from '@logto/schemas';
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

/** Deliberately omit all user, session, application, and request context. */
export const buildWebhookRequestBody = (url: string, payload: HookEventPayload) =>
  isSlackWebhookUrl(url) ? { text: `${payload.event} at ${payload.createdAt}` } : payload;

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
