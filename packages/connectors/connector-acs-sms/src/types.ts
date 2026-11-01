import { z } from 'zod/v3';

/**
 * Template usage types that must be configured, so every sign-in flow and invitation can send a
 * message.
 */
const requiredTemplateUsageTypes = ['Register', 'SignIn', 'ForgotPassword', 'Generic'];

const templateGuard = z.object({
  usageType: z.string(),
  content: z.string(), // With variable {{code}}, plain text only
});

export const acsSmsConfigGuard = z.object({
  /** The ACS resource endpoint, e.g. `https://<resource>.communication.azure.com`. */
  endpoint: z.string().url(),
  /** A base64 access key of the ACS resource, used to sign each request with HMAC-SHA256. */
  accessKey: z.string().min(1),
  /** The sender phone number in E.164 format, acquired on the ACS resource. */
  fromNumber: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'fromNumber must be a phone number in E.164 format'),
  templates: z.array(templateGuard).refine(
    (templates) =>
      requiredTemplateUsageTypes.every((requiredType) =>
        templates.map((template) => template.usageType).includes(requiredType)
      ),
    (templates) => ({
      message: `Template with UsageType (${requiredTemplateUsageTypes
        .filter(
          (requiredType) => !templates.map((template) => template.usageType).includes(requiredType)
        )
        .join(', ')}) should be provided!`,
    })
  ),
});

export type AcsSmsConfig = z.infer<typeof acsSmsConfigGuard>;

/**
 * @doc https://learn.microsoft.com/en-us/rest/api/communication/sms/send
 */
export type SmsSendRequest = {
  from: string;
  smsRecipients: Array<{ to: string }>;
  message: string;
};

/** One entry of the `value` array in the send response. */
const smsSendResultGuard = z.object({
  to: z.string(),
  messageId: z.string(),
  httpStatusCode: z.number(),
  successful: z.boolean(),
  deliveryStatus: z.optional(z.string()),
  errorMessage: z.optional(z.string()),
});

export type SmsSendResult = z.infer<typeof smsSendResultGuard>;

export const smsSendResponseGuard = z.object({
  value: z.array(smsSendResultGuard),
});

export type SmsSendResponse = z.infer<typeof smsSendResponseGuard>;
