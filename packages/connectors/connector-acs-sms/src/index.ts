import { assert } from '@silverhand/essentials';
import { got, HTTPError } from 'got';
import { createHash, createHmac } from 'node:crypto';

import type {
  GetConnectorConfig,
  SendMessageFunction,
  CreateConnector,
  SmsConnector,
} from '@logto/connector-kit';
import {
  ConnectorError,
  ConnectorErrorCodes,
  validateConfig,
  ConnectorType,
  replaceSendMessageHandlebars,
  getConfigTemplateByType,
} from '@logto/connector-kit';

import { apiVersion, defaultMetadata } from './constant.js';
import { acsSmsConfigGuard, smsSendResponseGuard } from './types.js';
import type { AcsSmsConfig, SmsSendRequest, SmsSendResponse } from './types.js';

/**
 * Sign a request with the ACS access key, following the HMAC-SHA256 scheme of the ACS REST API:
 * the string to sign covers the method, the path and query, and the `x-ms-date`, host and body
 * hash signed headers. The same scheme backs the ACS email connector.
 *
 * @doc https://learn.microsoft.com/en-us/azure/communication-services/tutorials/hmac-header-tutorial
 */
export const signRequest = ({
  url,
  body,
  accessKey,
  date = new Date(),
}: {
  url: URL;
  body: string;
  accessKey: string;
  date?: Date;
}) => {
  const xMsDate = date.toUTCString();
  const contentHash = createHash('sha256').update(body).digest('base64');
  const stringToSign = [
    'POST',
    `${url.pathname}${url.search}`,
    `${xMsDate};${url.host};${contentHash}`,
  ].join('\n');
  const signature = createHmac('sha256', Buffer.from(accessKey, 'base64'))
    .update(stringToSign)
    .digest('base64');

  return {
    'x-ms-date': xMsDate,
    'x-ms-content-sha256': contentHash,
    Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
  };
};

const buildRequest = (to: string, config: AcsSmsConfig, content: string): SmsSendRequest => ({
  from: config.fromNumber,
  smsRecipients: [{ to }],
  message: content,
});

/**
 * ACS answers 202 with a per-recipient result even when the send is rejected, so `successful`
 * decides the outcome; the rejection detail is in `errorMessage`.
 */
const assertSendSuccessful = ({ value }: SmsSendResponse, to: string) => {
  const result = value.find((entry) => entry.to === to) ?? value[0];

  assert(result, new ConnectorError(ConnectorErrorCodes.InvalidResponse, 'No recipient result'));

  if (!result.successful) {
    throw new ConnectorError(
      ConnectorErrorCodes.General,
      result.errorMessage ?? `ACS rejected the message with status ${result.httpStatusCode}`
    );
  }
};

const sendMessage =
  (getConfig: GetConnectorConfig): SendMessageFunction =>
  async (data, inputConfig) => {
    const { to, type, payload } = data;
    const config = inputConfig ?? (await getConfig(defaultMetadata.id));
    validateConfig(config, acsSmsConfigGuard);

    const template = getConfigTemplateByType(type, config);

    assert(
      template,
      new ConnectorError(
        ConnectorErrorCodes.TemplateNotFound,
        `Cannot find template for type: ${type}`
      )
    );

    const smsRequest = buildRequest(
      to,
      config,
      replaceSendMessageHandlebars(template.content, payload)
    );

    const url = new URL(`/sms?api-version=${apiVersion}`, config.endpoint);
    const body = JSON.stringify(smsRequest);

    try {
      const response = await got.post(url, {
        headers: {
          ...signRequest({ url, body, accessKey: config.accessKey }),
          'Content-Type': 'application/json',
        },
        body,
      });

      const parsed = smsSendResponseGuard.safeParse(JSON.parse(response.body));

      assert(
        parsed.success,
        new ConnectorError(ConnectorErrorCodes.InvalidResponse, response.body)
      );

      assertSendSuccessful(parsed.data, to);

      return parsed.data;
    } catch (error: unknown) {
      if (error instanceof ConnectorError) {
        throw error;
      }

      if (error instanceof HTTPError) {
        const rawBody: unknown = error.response.body;

        assert(
          typeof rawBody === 'string',
          new ConnectorError(
            ConnectorErrorCodes.InvalidResponse,
            `Invalid response raw body type: ${typeof rawBody}`
          )
        );

        throw new ConnectorError(ConnectorErrorCodes.General, rawBody);
      }

      throw new ConnectorError(ConnectorErrorCodes.General, error);
    }
  };

const createAcsSmsConnector: CreateConnector<SmsConnector> = async ({ getConfig }) => {
  return {
    metadata: defaultMetadata,
    type: ConnectorType.Sms,
    configGuard: acsSmsConfigGuard,
    sendMessage: sendMessage(getConfig),
  };
};

export default createAcsSmsConnector;
