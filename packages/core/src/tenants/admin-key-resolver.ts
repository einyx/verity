import { adminTenantId } from '@logto/schemas';
import type { JWTVerifyGetKey } from 'jose';

type AdminProvider = {
  envSet: { oidc: { localJWKSet: JWTVerifyGetKey } };
  requestEnd: () => void;
};

const providers = new Map<'admin', (tenantId: string) => Promise<AdminProvider>>();

/** Registered at startup by the tenant pool; avoids an initialization dependency cycle. */
export const registerAdminKeyProvider = (load: (tenantId: string) => Promise<AdminProvider>) => {
  providers.set('admin', load);
};

/** Cached provider lifecycle and key rotation are shared with the trusted admin issuer. */
export const getAdminTenantKey: JWTVerifyGetKey = async (header, token) => {
  const load = providers.get('admin');
  if (!load) {
    throw new Error('Admin key provider is not initialized');
  }
  const tenant = await load(adminTenantId);
  try {
    return await tenant.envSet.oidc.localJWKSet(header, token);
  } finally {
    tenant.requestEnd();
  }
};
