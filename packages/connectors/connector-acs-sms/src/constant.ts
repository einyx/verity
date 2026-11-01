import type { ConnectorMetadata } from '@logto/connector-kit';
import { ConnectorConfigFormItemType } from '@logto/connector-kit';

export const apiVersion = '2021-03-07';

export const defaultMetadata: ConnectorMetadata = {
  id: 'acs-sms-service',
  target: 'acs-sms',
  platform: null,
  name: {
    en: 'Azure Communication Services SMS',
    'zh-CN': 'Azure 通信服务短信',
  },
  logo: './logo.svg',
  logoDark: null,
  description: {
    en: 'Send transactional SMS through Azure Communication Services.',
    'zh-CN': '通过 Azure 通信服务发送事务性短信。',
  },
  readme: './README.md',
  formItems: [
    {
      key: 'endpoint',
      label: 'Endpoint',
      type: ConnectorConfigFormItemType.Text,
      required: true,
      placeholder: 'https://<your-resource>.communication.azure.com',
    },
    {
      key: 'accessKey',
      label: 'Access Key',
      type: ConnectorConfigFormItemType.Text,
      required: true,
      placeholder: '<your-acs-access-key>',
    },
    {
      key: 'fromNumber',
      label: 'Sender Phone Number',
      type: ConnectorConfigFormItemType.Text,
      required: true,
      placeholder: '+18001110000',
    },
    {
      key: 'templates',
      label: 'Templates',
      type: ConnectorConfigFormItemType.Json,
      required: true,
      defaultValue: [
        {
          usageType: 'SignIn',
          content:
            'Your meshX sign-in verification code is {{code}}. The code will remain active for 10 minutes.',
        },
        {
          usageType: 'Register',
          content:
            'Your meshX sign-up verification code is {{code}}. The code will remain active for 10 minutes.',
        },
        {
          usageType: 'ForgotPassword',
          content:
            'Your meshX password change verification code is {{code}}. The code will remain active for 10 minutes.',
        },
        {
          usageType: 'OrganizationInvitation',
          content:
            'Your meshX organization invitation code is {{code}}. The code will remain active for 10 minutes.',
        },
        {
          usageType: 'Generic',
          content:
            'Your meshX verification code is {{code}}. The code will remain active for 10 minutes.',
        },
        {
          usageType: 'UserPermissionValidation',
          content:
            'Your meshX permission validation code is {{code}}. The code will remain active for 10 minutes.',
        },
        {
          usageType: 'BindNewIdentifier',
          content:
            'Your meshX new identifier binding code is {{code}}. The code will remain active for 10 minutes.',
        },
        {
          usageType: 'MfaVerification',
          content:
            'Your meshX MFA verification code is {{code}}. The code will remain active for 10 minutes.',
        },
        {
          usageType: 'BindMfa',
          content:
            'Your meshX 2-step verification setup code is {{code}}. The code will remain active for 10 minutes.',
        },
      ],
    },
  ],
};
