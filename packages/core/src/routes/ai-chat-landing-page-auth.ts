import { extractBearerToken } from '@logto/mcp-portal';
import { CloudScope, getCloudApiIndicator, PredefinedScope } from '@logto/schemas';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { verifyBearerTokenFromRequest } from '#src/middleware/koa-auth/index.js';
import assertThat from '#src/utils/assert-that.js';

/** Keep Cloud editor authorization separate from tenant Management API authorization. */
export const getLandingPageAiToken = async (
  envSet: EnvSet,
  authorization: string,
  userId: string
) => {
  assertThat(authorization, new RequestError({ code: 'auth.unauthorized', status: 401 }));
  const { sub, clientId, scopes } = await verifyBearerTokenFromRequest(
    envSet,
    { headers: { authorization } },
    getCloudApiIndicator(EnvSet.values.cloudUrlSet.endpoint.origin)
  );

  assertThat(
    sub === userId &&
      sub !== clientId &&
      (scopes.includes(CloudScope.ManageLandingPage) || scopes.includes(PredefinedScope.All)),
    new RequestError({ code: 'auth.forbidden', status: 403 })
  );

  return extractBearerToken(authorization);
};
