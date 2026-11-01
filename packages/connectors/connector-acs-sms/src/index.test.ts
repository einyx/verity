import nock from 'nock';

import { ConnectorErrorCodes, TemplateType } from '@logto/connector-kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultMetadata } from './constant.js';
import createAcsSmsConnector, { signRequest } from './index.js';
import { acsSmsConfigGuard } from './types.js';

const config = {
  endpoint: 'https://contoso.communication.azure.com',
  accessKey: Buffer.from('fake-access-key').toString('base64'),
  fromNumber: '+18001110000',
  templates: [
    { usageType: 'Register', content: 'Register code: {{code}}' },
    { usageType: 'SignIn', content: 'Sign-in code: {{code}}' },
    { usageType: 'ForgotPassword', content: 'Reset code: {{code}}' },
    { usageType: 'Generic', content: 'Code: {{code}}' },
  ],
};

const getConfig = vi.fn(async () => config);

describe('ACS SMS connector', () => {
  describe('signRequest', () => {
    it('produces the ACS HMAC-SHA256 header set', () => {
      const url = new URL('/sms?api-version=2021-03-07', config.endpoint);
      const body = JSON.stringify({ from: '+18001110000' });
      const headers = signRequest({ url, body, accessKey: config.accessKey });

      expect(headers['x-ms-date']).toBeTruthy();
      expect(headers['x-ms-content-sha256']).toBeTruthy();
      expect(headers.Authorization).toMatch(
        /^HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=.+$/
      );
    });

    it('is deterministic for identical inputs', () => {
      const url = new URL('/sms?api-version=2021-03-07', config.endpoint);
      const body = '{"message":"hi"}';
      const date = new Date('2026-01-01T00:00:00Z');

      const first = signRequest({ url, body, accessKey: config.accessKey, date });
      const second = signRequest({ url, body, accessKey: config.accessKey, date });

      expect(first.Authorization).toEqual(second.Authorization);
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      nock.cleanAll();
    });

    it('signs and posts the rendered template to the ACS SMS endpoint', async () => {
      const scope = nock(config.endpoint)
        .post('/sms', {
          from: config.fromNumber,
          smsRecipients: [{ to: '+11234567890' }],
          message: 'Sign-in code: 123456',
        })
        .query({ 'api-version': '2021-03-07' })
        .matchHeader('x-ms-date', /.+/)
        .matchHeader('x-ms-content-sha256', /.+/)
        .matchHeader(
          'authorization',
          /^HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=.+$/
        )
        .reply(202, {
          value: [
            {
              to: '+11234567890',
              messageId: 'outgoing_20260101',
              httpStatusCode: 202,
              successful: true,
            },
          ],
        });

      const connector = await createAcsSmsConnector({ getConfig });
      const response = await connector.sendMessage({
        to: '+11234567890',
        type: TemplateType.SignIn,
        payload: { code: '123456' },
      });

      expect(scope.isDone()).toBe(true);
      expect(response).toMatchObject({ value: [{ to: '+11234567890', successful: true }] });
    });

    it('throws with the ACS error message when the recipient is rejected', async () => {
      nock(config.endpoint)
        .post('/sms')
        .query(true)
        .reply(202, {
          value: [
            {
              to: '+11234567890',
              messageId: 'outgoing_20260101',
              httpStatusCode: 400,
              successful: false,
              errorMessage: 'Recipient phone number is not reachable from the sender.',
            },
          ],
        });

      const connector = await createAcsSmsConnector({ getConfig });

      await expect(
        connector.sendMessage({
          to: '+11234567890',
          type: TemplateType.SignIn,
          payload: { code: '123456' },
        })
      ).rejects.toThrowError('Recipient phone number is not reachable from the sender.');
    });

    it('surfaces the ACS error body on an HTTP error', async () => {
      nock(config.endpoint)
        .post('/sms')
        .query(true)
        .reply(401, { error: { code: 'Unauthorized', message: 'Invalid access key' } });

      const connector = await createAcsSmsConnector({ getConfig });

      await expect(
        connector.sendMessage({
          to: '+11234567890',
          type: TemplateType.SignIn,
          payload: { code: '123456' },
        })
      ).rejects.toThrowError('Invalid access key');
    });

    it('falls back to the generic template when the usage-specific template is missing', async () => {
      const scope = nock(config.endpoint)
        .post('/sms', {
          from: config.fromNumber,
          smsRecipients: [{ to: '+11234567890' }],
          message: 'Code: 123456',
        })
        .query(true)
        .reply(202, {
          value: [
            {
              to: '+11234567890',
              messageId: 'outgoing_20260101',
              httpStatusCode: 202,
              successful: true,
            },
          ],
        });

      const connector = await createAcsSmsConnector({ getConfig });
      await connector.sendMessage({
        to: '+11234567890',
        // BindMfa has no dedicated template in the test config.
        type: TemplateType.BindMfa,
        payload: { code: '123456' },
      });

      expect(scope.isDone()).toBe(true);
    });

    it('rejects a config that misses the required generic template', async () => {
      getConfig.mockResolvedValueOnce({
        ...config,
        templates: config.templates.filter(({ usageType }) => usageType !== 'Generic'),
      });

      const connector = await createAcsSmsConnector({ getConfig });

      await expect(
        connector.sendMessage({
          to: '+11234567890',
          type: TemplateType.BindMfa,
          payload: { code: '123456' },
        })
      ).rejects.toMatchObject({ code: ConnectorErrorCodes.InvalidConfig });
    });

    it('rejects a config that misses a required template usage type', () => {
      const parse = acsSmsConfigGuard.safeParse({
        ...config,
        templates: config.templates.filter(({ usageType }) => usageType !== 'SignIn'),
      });

      expect(parse.success).toBe(false);
    });

    it('rejects a fromNumber that is not E.164', () => {
      const parse = acsSmsConfigGuard.safeParse({ ...config, fromNumber: '18001110000' });

      expect(parse.success).toBe(false);
    });
  });

  describe('metadata', () => {
    it('declares the SMS connector type and stable factory id', async () => {
      const connector = await createAcsSmsConnector({ getConfig });

      expect(connector.type).toBe('Sms');
      expect(defaultMetadata.id).toBe('acs-sms-service');
    });
  });
});
