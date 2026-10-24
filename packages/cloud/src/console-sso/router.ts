import { randomUUID } from 'node:crypto';

import { RequestError, Router } from '@withtyped/server';
import { z } from 'zod';

import { type OperatorAuthConfig, type VerifiedCaller, verifyCaller } from '../billing/auth.js';

import { type CoreSsoClient, type ConsoleSsoSecrets, syncCoreBinding } from './core-binding.js';
import {
  challengeRecordName,
  challengeRecordValue,
  createChallengeToken,
  defaultTxtResolver,
  isDomainChallengeSatisfied,
  type TxtResolver,
} from './dns.js';
import { type ConsoleSsoConnectorRecord, type ConsoleSsoStore } from './store.js';
import {
  addConsoleSsoDomainBodyGuard,
  consoleSsoConnectorGuard,
  consoleSsoDomainChallengeGuard,
  consoleSsoProviderGuard,
  consoleSsoProviders,
  createConsoleSsoConnectorBodyGuard,
} from './types.js';

export type ConsoleSsoRouterConfig = {
  auth: Pick<OperatorAuthConfig, 'issuer' | 'audience' | 'getKey'>;
  store: ConsoleSsoStore;
  /** Connections the account may create, from its Pro plan entitlement. */
  getConnectorLimit: (caller: VerifiedCaller) => Promise<number>;
  resolveTxt?: TxtResolver;
  /** Client secrets live here, never in the database. */
  secrets: ConsoleSsoSecrets;
  /** Core's Enterprise SSO API. Without it, domains verify but no sign-in connector is created. */
  core?: CoreSsoClient;
};

const toConnectorView = (record: ConsoleSsoConnectorRecord) => ({
  id: record.id,
  provider: record.provider,
  displayName: record.displayName,
  clientId: record.clientId,
  domains: record.domains.map(({ domain, verifiedAt }) => ({ domain, verifiedAt })),
  createdAt: record.createdAt.toISOString(),
});

/**
 * Console SSO routes for the signed-in account. Every route is scoped to the caller's own
 * connections; a connection that belongs to someone else reads as not found.
 */
export const createConsoleSsoRouter = (config: ConsoleSsoRouterConfig) => {
  const { auth, store } = config;
  const resolveTxt = config.resolveTxt ?? defaultTxtResolver;

  const requireCaller = async (authorization: string | undefined) =>
    verifyCaller(authorization, auth);

  /** Pushes the verified domains to core, creating the sign-in connector on the first one. */
  const bindVerifiedDomains = async (caller: VerifiedCaller, connectorId: string) => {
    if (!config.core) {
      return;
    }

    const current = await store.findConnector(caller.sub, connectorId);

    if (!current) {
      return;
    }

    const verifiedDomains = current.domains
      .filter((item) => item.verifiedAt)
      .map((item) => item.domain);

    if (verifiedDomains.length === 0) {
      return;
    }

    const coreConnectorId = await syncCoreBinding({
      connector: { ...current, coreConnectorId: current.coreConnectorId },
      verifiedDomains,
      core: config.core,
      secrets: config.secrets,
    });

    if (coreConnectorId !== current.coreConnectorId) {
      await store.setCoreConnectorId(caller.sub, connectorId, coreConnectorId);
    }
  };

  const requireOwnedConnector = async (caller: VerifiedCaller, connectorId: string) => {
    const connector = await store.findConnector(caller.sub, connectorId);

    if (!connector) {
      throw new RequestError('Connector not found', 404);
    }

    return connector;
  };

  return new Router()
    .get(
      '/api/me/console-sso/providers',
      { response: z.array(z.object({ id: consoleSsoProviderGuard, name: z.string() })) },
      async (context, next) => {
        await requireCaller(context.request.headers.authorization);

        return next({ ...context, json: consoleSsoProviders.map((provider) => ({ ...provider })) });
      }
    )
    .get(
      '/api/me/console-sso/connectors',
      { response: z.array(consoleSsoConnectorGuard) },
      async (context, next) => {
        const caller = await requireCaller(context.request.headers.authorization);
        const connectors = await store.listConnectors(caller.sub);

        return next({
          ...context,
          json: connectors.map((connector) => toConnectorView(connector)),
        });
      }
    )
    .get(
      '/api/me/console-sso/connectors/:connectorId',
      { response: consoleSsoConnectorGuard },
      async (context, next) => {
        const caller = await requireCaller(context.request.headers.authorization);
        const connector = await requireOwnedConnector(caller, context.guarded.params.connectorId);

        return next({ ...context, json: toConnectorView(connector) });
      }
    )
    .post(
      '/api/me/console-sso/connectors',
      { body: createConsoleSsoConnectorBodyGuard, response: consoleSsoConnectorGuard },
      async (context, next) => {
        const caller = await requireCaller(context.request.headers.authorization);
        const limit = await config.getConnectorLimit(caller);
        const existing = await store.countConnectors(caller.sub);

        if (existing >= limit) {
          throw new RequestError('Console SSO connector limit reached for this plan', 403);
        }

        const { provider, displayName, clientId, clientSecret } = context.guarded.body;
        const id = randomUUID();
        await config.secrets.putClientSecret(id, clientSecret);
        const created = await store.createConnector({
          id,
          ownerSub: caller.sub,
          provider,
          displayName,
          clientId,
          createdAt: new Date(),
        });

        return next({ ...context, json: toConnectorView(created) });
      }
    )
    .delete(
      '/api/me/console-sso/connectors/:connectorId',
      { response: z.object({}) },
      async (context, next) => {
        const caller = await requireCaller(context.request.headers.authorization);
        await requireOwnedConnector(caller, context.guarded.params.connectorId);
        await store.deleteConnector(caller.sub, context.guarded.params.connectorId);

        return next({ ...context, json: {} });
      }
    )
    .post(
      '/api/me/console-sso/connectors/:connectorId/domains',
      { body: addConsoleSsoDomainBodyGuard, response: consoleSsoDomainChallengeGuard },
      async (context, next) => {
        const caller = await requireCaller(context.request.headers.authorization);
        const connector = await requireOwnedConnector(caller, context.guarded.params.connectorId);
        const { domain: domainName } = context.guarded.body;

        // Re-submitting a domain returns its existing challenge, so the customer can retry DNS later.
        const record =
          connector.domains.find((item) => item.domain === domainName) ??
          (await store.addDomain(caller.sub, connector.id, domainName, createChallengeToken()));

        if (!record) {
          throw new RequestError('Domain could not be added', 409);
        }

        if (!record.verifiedAt) {
          const satisfied = await isDomainChallengeSatisfied(domainName, record.token, resolveTxt);

          if (satisfied) {
            await store.markDomainVerified(caller.sub, connector.id, domainName, new Date());
            await bindVerifiedDomains(caller, connector.id);
          }
        }

        const refreshed = await requireOwnedConnector(caller, connector.id);
        const domain = refreshed.domains.find((item) => item.domain === domainName);

        if (!domain) {
          throw new RequestError('Domain could not be added', 409);
        }

        return next({
          ...context,
          json: {
            domain: { domain: domain.domain, verifiedAt: domain.verifiedAt },
            challenge: {
              recordName: challengeRecordName(domain.domain),
              recordValue: challengeRecordValue(domain.token),
            },
          },
        });
      }
    );
};
