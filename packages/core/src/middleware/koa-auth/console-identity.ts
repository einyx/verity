import { buildOrganizationUrn } from '@logto/core-kit';
import { adminTenantId, defaultManagementApi, getTenantOrganizationId } from '@logto/schemas';
import { createLocalJWKSet, jwtVerify } from 'jose';

import type { EnvSet } from '#src/env-set/index.js';

import { getAdminTenantTokenValidationSet } from './utils.js';

/** Reverify the original bearer: a merged tenant/admin keyset cannot establish provenance. */
export const isVerifiedConsoleIdentity = async (
  envSet: EnvSet,
  bearer: string,
  subject: string,
  clientId: unknown
): Promise<boolean> => {
  if (subject === clientId) {
    return false;
  }
  const adminSet =
    envSet.tenantId === adminTenantId
      ? { keys: envSet.oidc.publicJwks, issuer: [envSet.oidc.issuer] }
      : await getAdminTenantTokenValidationSet();
  try {
    const { payload } = await jwtVerify(bearer, createLocalJWKSet({ keys: adminSet.keys }), {
      issuer: adminSet.issuer,
      subject,
      audience: [
        defaultManagementApi.resource.indicator,
        buildOrganizationUrn(getTenantOrganizationId(envSet.tenantId)),
      ],
    });
    return Boolean(payload.sub && payload.sub !== payload.client_id);
  } catch {
    return false;
  }
};
