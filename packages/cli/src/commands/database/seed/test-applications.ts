import {
  type Application,
  buildDemoAppDataForTenant,
  buildDeviceDemoAppDataForTenant,
  defaultTenantId,
} from '@logto/schemas';
import { GlobalValues } from '@logto/shared';
import { appendPath } from '@silverhand/essentials';
import type { CommonQueryMethods } from '@silverhand/slonik';

import { insertInto } from '../../../database.js';

/** Resolve the default tenant like the runtime, rather than registering wildcard/raw base URLs. */
export const getTestApplicationEndpoints = (values: GlobalValues): URL[] => {
  if (values.isPathBasedMultiTenancy) {
    return values.urlSet.deduplicated().map((endpoint) => appendPath(endpoint, defaultTenantId));
  }

  if (values.isDomainBasedMultiTenancy) {
    const endpoint = new URL(values.urlSet.endpoint);
    // eslint-disable-next-line @silverhand/fp/no-mutation -- only updates a fresh URL used by test seed data
    endpoint.hostname = endpoint.hostname.startsWith('*.')
      ? endpoint.hostname.slice(2)
      : endpoint.hostname.replaceAll('*', defaultTenantId);
    return [endpoint];
  }

  return values.urlSet.deduplicated();
};

/** Registered fixtures for `db seed --test`, not automatically served production demo clients. */
export const buildTestApplications = (endpoints: readonly URL[]): Application[] => {
  const loginRedirectUris = endpoints.map((endpoint) => appendPath(endpoint, 'demo-app').href);
  const deviceLogoutUris = endpoints.map(
    (endpoint) => appendPath(endpoint, 'device-demo-app').href
  );

  return [
    {
      ...buildDemoAppDataForTenant(defaultTenantId),
      oidcClientMetadata: {
        redirectUris: loginRedirectUris,
        postLogoutRedirectUris: loginRedirectUris,
      },
    },
    {
      ...buildDeviceDemoAppDataForTenant(defaultTenantId),
      oidcClientMetadata: { redirectUris: [], postLogoutRedirectUris: deviceLogoutUris },
    },
  ];
};

export const seedTestApplications = async (connection: CommonQueryMethods) =>
  connection.query(
    insertInto(
      buildTestApplications(getTestApplicationEndpoints(new GlobalValues())),
      'applications'
    )
  );
