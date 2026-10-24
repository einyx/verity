import { protectedAppAdditionalScopes } from '@logto/core-kit';
import {
  applicationCreateGuard as originalApplicationCreateGuard,
  applicationPatchGuard as originalApplicationPatchGuard,
} from '@logto/schemas';
import { z } from 'zod';

const protectedAppAdditionalScopeGuard = z.enum(protectedAppAdditionalScopes);

export const appLevelAccessControlEnabledGuard = z.boolean().optional();

export const applicationCreateGuard = originalApplicationCreateGuard
  .omit({
    protectedAppMetadata: true,
  })
  .extend({
    protectedAppMetadata: z
      .object({
        subDomain: z.string(),
        origin: z.string(),
      })
      .optional(),
    /** Caller-chosen client ID, in Logto's standard ID format. Generated when omitted. */
    id: z
      .string()
      .regex(/^[\da-z]{21}$/)
      .optional(),
    /** Caller-chosen value of the default client secret. Generated when omitted. */
    secretValue: z.string().min(32).max(128).optional(),
  });

export const applicationPatchGuard = originalApplicationPatchGuard
  .omit({
    protectedAppMetadata: true,
  })
  .extend({
    appLevelAccessControlEnabled: appLevelAccessControlEnabledGuard,
    protectedAppMetadata: z
      .object({
        origin: z.string().optional(),
        sessionDuration: z.number().optional(),
        pageRules: z
          .array(
            z.object({
              /* The path pattern (regex) to match */
              path: z.string(),
            })
          )
          .optional(),
        additionalScopes: z.array(protectedAppAdditionalScopeGuard).optional(),
      })
      .nullish(),
  });
