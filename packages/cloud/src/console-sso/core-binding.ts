import { type ConsoleSsoProviderId } from './types.js';

/**
 * The Enterprise SSO connector shape core accepts. Values mirror core's `SsoProviderName` and its
 * connector config guards, so core validates the same fields it validates for any other connector.
 */
export const coreProviderNames = {
  google: 'GoogleWorkspace',
  microsoft: 'AzureAdOidc',
} as const satisfies Record<ConsoleSsoProviderId, string>;

/** Microsoft Entra ID's multi-tenant issuer. The connector accepts sign-ins from any tenant. */
export const microsoftIssuer = 'https://login.microsoftonline.com/common/v2.0';

export type CoreConnectorPayload = {
  providerName: string;
  connectorName: string;
  config: Record<string, string>;
  domains: string[];
};

/** Builds the core payload for a connection. The client secret comes from the secret store only. */
export const toCoreConnectorPayload = (input: {
  provider: ConsoleSsoProviderId;
  displayName: string;
  clientId: string;
  clientSecret: string;
  domains: string[];
}): CoreConnectorPayload => ({
  providerName: coreProviderNames[input.provider],
  connectorName: input.displayName,
  config: {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    ...(input.provider === 'microsoft' ? { issuer: microsoftIssuer } : {}),
  },
  domains: input.domains,
});

/** The subset of core's Enterprise SSO API the binding uses. */
export type CoreSsoClient = {
  createConnector(payload: CoreConnectorPayload): Promise<{ id: string }>;
  updateConnectorDomains(connectorId: string, domains: string[]): Promise<void>;
};

/** Secret storage for client secrets. Production uses the vault; secrets never live in the database. */
export type ConsoleSsoSecrets = {
  putClientSecret(connectorId: string, secret: string): Promise<void>;
  getClientSecret(connectorId: string): Promise<string | undefined>;
};

export const createInMemorySecrets = (): ConsoleSsoSecrets => {
  const values = new Map<string, string>();

  return {
    async putClientSecret(connectorId, secret) {
      values.set(connectorId, secret);
    },
    async getClientSecret(connectorId) {
      return values.get(connectorId);
    },
  };
};

/**
 * Creates the core connector for a connection the first time a domain verifies, and keeps its
 * domain list in step after that. Returns the core connector ID to store on the connection.
 */
export const syncCoreBinding = async (input: {
  connector: {
    id: string;
    provider: ConsoleSsoProviderId;
    displayName: string;
    clientId: string;
    coreConnectorId?: string;
  };
  verifiedDomains: string[];
  core: CoreSsoClient;
  secrets: ConsoleSsoSecrets;
}): Promise<string> => {
  const { connector, verifiedDomains, core, secrets } = input;

  if (verifiedDomains.length === 0) {
    throw new Error('No verified domains to bind');
  }

  if (connector.coreConnectorId) {
    await core.updateConnectorDomains(connector.coreConnectorId, verifiedDomains);

    return connector.coreConnectorId;
  }

  const clientSecret = await secrets.getClientSecret(connector.id);

  if (!clientSecret) {
    throw new Error('Client secret is missing for this connection');
  }

  const created = await core.createConnector(
    toCoreConnectorPayload({
      provider: connector.provider,
      displayName: connector.displayName,
      clientId: connector.clientId,
      clientSecret,
      domains: verifiedDomains,
    })
  );

  return created.id;
};
