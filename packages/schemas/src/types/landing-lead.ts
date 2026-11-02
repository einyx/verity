import { z } from 'zod/v3';

export const demoContactMethods = ['email', 'whatsapp', 'phone', 'linkedin'] as const;

/** Visitor-declared fields. Declining surname/company must remain valid end to end. */
export const landingLeadFieldsGuard = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(254),
  company: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().max(120).optional(),
  industry: z.string().trim().max(80).optional(),
  interests: z.array(z.string().trim().max(60)).max(10).optional(),
  decision: z.string().trim().max(200).optional(),
  contactMethod: z.enum(demoContactMethods).optional(),
  contactDetail: z.string().trim().max(200).optional(),
});

export const demoLeadGuard = landingLeadFieldsGuard
  .extend({ consent: z.literal(true) })
  .strict()
  .superRefine((lead, context) => {
    if (lead.contactMethod && lead.contactMethod !== 'email' && !lead.contactDetail) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contactDetail'],
        message: 'A contact method other than email needs a number or profile link.',
      });
    }
  });

/** Storage/list contract retains CRM fields and accepts older records without a consent key. */
export const landingLeadRecordGuard = z.object({
  id: z.string(),
  sessionId: z.string(),
  lead: landingLeadFieldsGuard.passthrough(),
  emailStatus: z.string(),
  status: z.string(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  companyProfile: z.record(z.unknown()).nullable().optional(),
  createdAt: z.union([z.string(), z.number()]),
});
export const landingLeadsResponseGuard = z.object({
  leads: landingLeadRecordGuard.array(),
  totalCount: z.number().int().nonnegative(),
  bookingUrl: z.string().nullable().optional(),
});
