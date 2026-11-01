# Azure Communication Services SMS connector

Send transactional SMS messages through [Azure Communication Services](https://learn.microsoft.com/en-us/azure/communication-services/), for sign-in codes, password resets, and invitations.

## Set up Azure Communication Services

1. Create an Azure Communication Services resource in the [Azure portal](https://portal.azure.com/#create/Microsoft.AzureCommunicationServices). Note the **endpoint** (`https://<your-resource>.communication.azure.com`) from the resource overview.
2. On the resource's **Keys** page, copy the primary **Access key**.
3. Acquire a phone number that can send SMS, following the [sender types guide](https://learn.microsoft.com/en-us/azure/communication-services/concepts/sms/concepts#sender-types-supported). The number must be E.164 formatted (for example `+18001110000`).

> Sender numbers are country/region-scoped: a sender can deliver messages only within the country or region it was provisioned for. Cross-country delivery from a single sender is not supported.

## Fill in the configuration in Logto

| Name       | Type   |
| ---------- | ------ |
| endpoint   | string |
| accessKey  | string |
| fromNumber | string |
| templates  | object[] |

- **Endpoint** — the ACS resource endpoint, e.g. `https://contoso.communication.azure.com`.
- **Access Key** — the primary key of the resource. Requests are signed with HMAC-SHA256; the key never leaves your Logto instance.
- **Sender Phone Number** — the acquired number in E.164 format, e.g. `+18001110000`.
- **Templates** — one entry per usage type, each with `usageType` and `content`. The `{{code}}` placeholder is replaced with the verification code. `Register`, `SignIn`, `ForgotPassword`, and `Generic` are required.

## Reference

- [SMS overview](https://learn.microsoft.com/en-us/azure/communication-services/concepts/sms/concepts)
- [SMS Send REST API](https://learn.microsoft.com/en-us/rest/api/communication/sms/send)
- [HMAC request signing](https://learn.microsoft.com/en-us/azure/communication-services/tutorials/hmac-header-tutorial)
