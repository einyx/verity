import {
  buildWebhookRequestBody,
  isSlackWebhookUrl,
  redactSlackWebhookSecrets,
} from './slack-payload.js';
import { generateHookTestPayload } from './utils.js';

const url = 'https://hooks.slack.com/services/T_TEST/B_TEST/TEST_ONLY_SECRET';

describe('Slack endpoint boundary', () => {
  it.each([url, 'https://hooks.slack.com:443/services/T123/B456/aB09_-'])(
    'accepts a standard HTTPS endpoint: %s',
    (endpoint) => {
      expect(isSlackWebhookUrl(endpoint)).toBe(true);
    }
  );

  it.each([
    'not a URL',
    'https://hooks.slack.com./services/T/B/S',
    'https://hooks.slack.com/services//B/S',
    'https://hooks.slack.com/services/T/B/S/',
    'https://hooks.slack.com/services/T/B/S%2Fsecret',
    'https://hooks.slack.com/services/T/B/S%20secret',
  ])('leaves noncanonical endpoints untouched: %s', (endpoint) => {
    const payload = generateHookTestPayload('test-hook', 'User.Data.Updated');
    expect(isSlackWebhookUrl(endpoint)).toBe(false);
    expect(buildWebhookRequestBody(endpoint, payload)).toBe(payload);
  });

  it('redacts echoed URL and bearer secret while retaining response diagnostics', () => {
    expect(redactSlackWebhookSecrets(url, `invalid_token ${url} TEST_ONLY_SECRET`)).toBe(
      'invalid_token [Slack webhook] [redacted]'
    );
    expect(redactSlackWebhookSecrets('https://example.com', 'generic diagnostic')).toBe(
      'generic diagnostic'
    );
  });
});
