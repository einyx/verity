/* eslint-disable @typescript-eslint/ban-types -- The existing cloud store returns null for missing database rows. */
import { existsSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { type CommonQueryMethods } from '@silverhand/slonik';
import { type JWTVerifyGetKey } from 'jose';

/** Only the store operations core needs; billing internals remain in the private package. */
export type CloudBillingStore = {
  findMembership: (
    tenantId: string,
    identity: { issuer: string; sub: string }
  ) => Promise<string | null | undefined>;
  findSubscription: (tenantId: string) => Promise<{ currentPeriodStart: string } | null>;
};

type BillingHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/** The existing cloud exports consumed by this host, without a private build dependency. */
type CloudPlugin = {
  createPgBillingStore: (pool: CommonQueryMethods) => CloudBillingStore;
  migrateBillingSchema: (pool: CommonQueryMethods) => Promise<unknown>;
  createBillingComposer: (options: {
    store: CloudBillingStore;
    auth: {
      issuer: string;
      audience: string;
      getKey: JWTVerifyGetKey;
      operators: Array<{ issuer: string; sub: string }>;
    };
    checkout: {
      stripeSecretKey: string;
      priceIdBySkuId: Record<string, string>;
      returnOrigins: string[];
    };
    stripeSecretKey: string;
    stripeWebhookSecret: string;
  }) => unknown;
  createBillingHandler: (composer: unknown) => BillingHandler;
  stripeWebhookPath: string;
};

const isCloudPlugin = (value: unknown): value is CloudPlugin =>
  typeof value === 'object' &&
  value !== null &&
  [
    'createPgBillingStore',
    'migrateBillingSchema',
    'createBillingComposer',
    'createBillingHandler',
  ].every((key) => typeof Reflect.get(value, key) === 'function') &&
  Reflect.get(value, 'stripeWebhookPath') === '/api/webhooks/stripe';

/** Resolve from the host, including its production workspace links, not the process cwd. */
export const createCloudPluginLoader = (baseUrl: string) => {
  const require = createRequire(baseUrl);
  const loads = new Map<string, Promise<CloudPlugin>>();
  const isInstalled = () =>
    (require.resolve.paths('@meshx/cloud') ?? []).some((directory) =>
      existsSync(path.join(directory, '@meshx/cloud/package.json'))
    );

  const load = async (): Promise<CloudPlugin> => {
    if (!isInstalled()) {
      throw new Error('Cloud plugin is not installed');
    }

    const specifier = pathToFileURL(require.resolve('@meshx/cloud/routes')).href;
    const existing = loads.get(specifier);
    if (existing) {
      return existing;
    }

    const loading = (async () => {
      const plugin: unknown = await import(specifier);
      if (!isCloudPlugin(plugin)) {
        throw new Error('Incompatible cloud plugin: expected billing route/store exports');
      }
      return plugin;
    })();
    loads.set(specifier, loading);
    return loading;
  };

  return { isInstalled, load };
};

/* eslint-enable @typescript-eslint/ban-types */
