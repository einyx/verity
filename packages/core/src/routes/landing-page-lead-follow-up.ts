import { createHash } from 'node:crypto';

import { adminTenantId, isSyntheticLandingLead } from '@logto/schemas';
import { z } from 'zod/v3';

import { sendMail, type AcsMailConfig } from '#src/libraries/acs-mail.js';

import { hashBody, type PendingAction, type PendingActionStore } from './ai-chat-actions.js';

export type FollowUpStore = Pick<PendingActionStore, 'findById' | 'claim' | 'setOutcome'> & {
  reserve: (action: PendingAction) => Promise<void>;
};

const unfinishedSignature = /\[(?:your\s+(?:name|company)|sender\s+name|company\s+name)]/i;
const bodyGuard = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\n\r]+$/)
      .refine((value) => !value.includes('\0')),
    text: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .refine((text) => !unfinishedSignature.test(text)),
    confirmed: z.literal(true),
    idempotencyKey: z
      .string()
      .min(16)
      .max(80)
      .regex(/^[\w-]+$/),
  })
  .strict();
const contactGuard = z.object({
  email: z.string().trim().email().max(254),
  consent: z.literal(true),
  contactMethod: z.literal('email').optional(),
});

export type FollowUpCode =
  | 'invalid_input'
  | 'contact_not_allowed'
  | 'unconfigured'
  | 'conflict'
  | 'processing'
  | 'rate_limited'
  | 'unknown';
type FollowUpResult =
  { ok: true; status: 'accepted'; requestId: string } | { ok: false; code: FollowUpCode };

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const mailHtml = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`
    )
    .join('');

const previousOutcome = (
  existing: PendingAction | undefined,
  id: string,
  userId: string,
  fingerprint: string
): FollowUpResult | undefined => {
  if (
    !existing ||
    existing.userId !== userId ||
    existing.bodyHash !== fingerprint ||
    existing.tool !== 'send_lead_follow_up'
  ) {
    return { ok: false, code: 'conflict' };
  }
  if (existing.state === 'executed') {
    return z.object({ status: z.literal('accepted') }).safeParse(existing.result).success
      ? { ok: true, status: 'accepted', requestId: id }
      : { ok: false, code: 'unknown' };
  }
};

/** Reserves and claims the reviewed message before ACS; an uncertain outcome can never be replayed. */
export const sendLeadFollowUp = async ({
  store,
  userId,
  sessionId,
  lead,
  isSynthetic,
  profile,
  tags,
  body,
  config,
  now,
  allowSend,
  deliver = sendMail,
}: {
  store: FollowUpStore;
  userId: string;
  sessionId: string;
  lead: unknown;
  isSynthetic: boolean;
  profile?: { syntheticContact?: unknown; researchStatus?: unknown; domain?: unknown } | undefined;
  tags?: unknown;
  body: unknown;
  config: AcsMailConfig | undefined;
  now: Date;
  allowSend: () => Promise<boolean>;
  deliver?: typeof sendMail;
}): Promise<FollowUpResult> => {
  const parsed = bodyGuard.safeParse(body);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input' };
  }
  const contact = contactGuard.safeParse(lead);
  if (
    !contact.success ||
    isSynthetic ||
    isSyntheticLandingLead({ email: contact.data.email, profile, tags })
  ) {
    return { ok: false, code: 'contact_not_allowed' };
  }
  if (!config) {
    return { ok: false, code: 'unconfigured' };
  }
  const request = parsed.data;
  const text = request.text.replaceAll(/\r\n?/g, '\n');
  const mail = {
    recipient: contact.data.email,
    sender: config.sender,
    subject: request.subject,
    text,
    sessionId,
  };
  const id = createHash('sha256')
    .update(JSON.stringify([adminTenantId, userId, sessionId, request.idempotencyKey]))
    .digest('base64url')
    .slice(0, 21);
  const fingerprint = hashBody(mail);
  await store.reserve({
    id,
    tenantId: adminTenantId,
    userId,
    tool: 'send_lead_follow_up',
    body: mail,
    bodyHash: fingerprint,
    state: 'pending',
    result: null,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
  });
  const existing = await store.findById(id, adminTenantId);
  const previous = previousOutcome(existing, id, userId, fingerprint);
  if (previous) {
    return previous;
  }
  const claimed = await store.claim(id, adminTenantId, userId, now);
  if (!claimed) {
    return { ok: false, code: 'processing' };
  }
  if (!(await allowSend())) {
    await store.setOutcome(id, 'cancelled', { status: 'blocked', reason: 'rate_limited' });
    return { ok: false, code: 'rate_limited' };
  }
  try {
    await deliver(
      { to: contact.data.email, subject: request.subject, text, html: mailHtml(text) },
      config
    );
  } catch {
    // A timeout can occur after ACS accepted the email. Retain the claim and never auto-resend.
    await store.setOutcome(id, 'executed', { status: 'unknown' });
    return { ok: false, code: 'unknown' };
  }
  await store.setOutcome(id, 'executed', { status: 'accepted', provider: 'acs' });
  return { ok: true, status: 'accepted', requestId: id };
};
