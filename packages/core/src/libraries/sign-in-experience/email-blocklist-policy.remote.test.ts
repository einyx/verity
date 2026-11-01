import nock from 'nock';

import { EnvSet } from '#src/env-set/index.js';

import {
  parseEmailBlocklistPolicy,
  validateEmailAgainstBlocklistPolicy,
} from './email-blocklist-policy.js';

const { jest } = import.meta;
const endpoint = 'https://validator.example.test';
const key = 'synthetic-test-key';
const email = 'synthetic@example.com';
const policy = { blockDisposableAddresses: true };

describe('owned disposable validator consumer contract (real non-test branch)', () => {
  beforeEach(() => {
    jest.replaceProperty(EnvSet.values, 'isUnitTest', false);
    jest.replaceProperty(EnvSet.values, 'isIntegrationTest', false);
    jest.replaceProperty(EnvSet.values, 'isCloud', true);
    jest.spyOn(EnvSet.values, 'azureFunctionAppEndpoint', 'get').mockReturnValue(endpoint);
    jest.spyOn(EnvSet.values, 'azureFunctionAppKey', 'get').mockReturnValue(key);
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.abortPendingRequests();
    nock.cleanAll();
    nock.enableNetConnect();
    jest.restoreAllMocks();
  });

  it('retains the missing-endpoint save guard', () => {
    jest.spyOn(EnvSet.values, 'azureFunctionAppEndpoint', 'get').mockReturnValue('');
    expect(() => parseEmailBlocklistPolicy(policy)).toThrow(
      'Disposable email domain validation requires AZURE_FUNCTION_APP_ENDPOINT to be configured'
    );
    expect(parseEmailBlocklistPolicy({ blockDisposableAddresses: false })).toEqual({
      blockDisposableAddresses: false,
    });
  });

  it('allows a configured save without contacting the service or changing the policy', () => {
    expect(parseEmailBlocklistPolicy(policy)).toEqual(policy);
  });

  it('sends the compatible HTTP method, path, JSON and key header', async () => {
    const request = nock(endpoint, { reqheaders: { 'x-functions-key': key } })
      .post('/api/disposable-email-domain-validation', { email })
      .reply(200, { isDisposable: false });
    await expect(validateEmailAgainstBlocklistPolicy(policy, email)).resolves.toBeUndefined();
    expect(request.isDone()).toBe(true);
  });

  it('rejects a disposable domain', async () => {
    const request = nock(endpoint)
      .post('/api/disposable-email-domain-validation')
      .reply(200, { isDisposable: true });
    await expect(validateEmailAgainstBlocklistPolicy(policy, email)).rejects.toMatchObject({
      code: 'session.email_blocklist.email_not_allowed',
      status: 422,
    });
    expect(request.isDone()).toBe(true);
  });

  it.each([401, 429, 503])(
    'fails closed on service HTTP %i without exposing request data',
    async (status) => {
      const request = nock(endpoint)
        .post('/api/disposable-email-domain-validation')
        .reply(status, { error: 'unavailable' });
      try {
        await validateEmailAgainstBlocklistPolicy(policy, email);
        throw new Error('Expected validator rejection');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'session.email_blocklist.disposable_email_validation_failed',
          status: 500,
        });
        expect(JSON.stringify(error)).not.toContain(email);
        expect(JSON.stringify(error)).not.toContain(key);
      }
      expect(request.isDone()).toBe(true);
    }
  );

  it.each([{}, { isDisposable: 'false' }, 'not-json'])(
    'fails closed on malformed response %j',
    async (body) => {
      const request = nock(endpoint)
        .post('/api/disposable-email-domain-validation')
        .reply(200, body);
      await expect(validateEmailAgainstBlocklistPolicy(policy, email)).rejects.toMatchObject({
        code: 'session.email_blocklist.disposable_email_validation_failed',
        status: 500,
      });
      expect(request.isDone()).toBe(true);
    }
  );

  it('does not call the service when policy is disabled', async () => {
    await expect(
      validateEmailAgainstBlocklistPolicy({ blockDisposableAddresses: false }, email)
    ).resolves.toBeUndefined();
  });

  it('bounds service latency rather than hanging an enabled-policy registration', async () => {
    nock(endpoint)
      .post('/api/disposable-email-domain-validation')
      .delay(2500)
      .reply(200, { isDisposable: false });
    await expect(validateEmailAgainstBlocklistPolicy(policy, email)).rejects.toMatchObject({
      code: 'session.email_blocklist.disposable_email_validation_failed',
      status: 500,
    });
  });
});
