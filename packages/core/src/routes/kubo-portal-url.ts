const defaultKuboPortalUrl = 'http://kubo-portal.kubo-system.svc.cluster.local:9090';

/** The Kubo portal that owns Foundation stacks. Set `KUBO_PORTAL_URL` to point elsewhere. */
export const kuboPortalUrl = () => process.env.KUBO_PORTAL_URL ?? defaultKuboPortalUrl;
