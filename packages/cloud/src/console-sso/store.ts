import { type ConsoleSsoConnector, type ConsoleSsoDomain } from './types.js';

/** A domain plus the challenge token, which is only ever shown to its owner. */
export type ConsoleSsoDomainRecord = ConsoleSsoDomain & { token: string };

export type ConsoleSsoConnectorRecord = Omit<ConsoleSsoConnector, 'domains' | 'createdAt'> & {
  ownerSub: string;
  createdAt: Date;
  domains: ConsoleSsoDomainRecord[];
  /** The Enterprise SSO connector in core, once the first domain has verified. */
  coreConnectorId?: string;
};

/**
 * Storage for Console SSO connections, scoped by owner. Every read and write takes the owner, so one
 * account can never see or change another account's connections.
 */
export type ConsoleSsoStore = {
  listConnectors(ownerSub: string): Promise<ConsoleSsoConnectorRecord[]>;
  findConnector(
    ownerSub: string,
    connectorId: string
  ): Promise<ConsoleSsoConnectorRecord | undefined>;
  countConnectors(ownerSub: string): Promise<number>;
  createConnector(
    record: Omit<ConsoleSsoConnectorRecord, 'domains'>
  ): Promise<ConsoleSsoConnectorRecord>;
  deleteConnector(ownerSub: string, connectorId: string): Promise<boolean>;
  /** Adds a domain to a connection. Returns `undefined` when the domain is already on it. */
  addDomain(
    ownerSub: string,
    connectorId: string,
    domain: string,
    token: string
  ): Promise<ConsoleSsoDomainRecord | undefined>;
  markDomainVerified(
    ownerSub: string,
    connectorId: string,
    domain: string,
    verifiedAt: Date
  ): Promise<void>;
  setCoreConnectorId(ownerSub: string, connectorId: string, coreConnectorId: string): Promise<void>;
};

/** In-memory store for tests and local runs. The Postgres store implements the same interface. */
export const createInMemoryConsoleSsoStore = (): ConsoleSsoStore => {
  // Records are replaced, never mutated, so a value read earlier stays a stable snapshot.
  const connectors = new Map<string, ConsoleSsoConnectorRecord>();

  const owned = (ownerSub: string) =>
    [...connectors.values()].filter((connector) => connector.ownerSub === ownerSub);

  const find = (ownerSub: string, connectorId: string) => {
    const connector = connectors.get(connectorId);

    return connector?.ownerSub === ownerSub ? connector : undefined;
  };

  const replaceDomains = (
    ownerSub: string,
    connectorId: string,
    update: (domains: ConsoleSsoDomainRecord[]) => ConsoleSsoDomainRecord[]
  ) => {
    const connector = find(ownerSub, connectorId);

    if (connector) {
      connectors.set(connectorId, { ...connector, domains: update(connector.domains) });
    }
  };

  return {
    async listConnectors(ownerSub) {
      return owned(ownerSub).toSorted(
        (first, second) => first.createdAt.getTime() - second.createdAt.getTime()
      );
    },
    async findConnector(ownerSub, connectorId) {
      return find(ownerSub, connectorId);
    },
    async countConnectors(ownerSub) {
      return owned(ownerSub).length;
    },
    async createConnector(record) {
      const created: ConsoleSsoConnectorRecord = { ...record, domains: [] };
      connectors.set(record.id, created);

      return created;
    },
    async deleteConnector(ownerSub, connectorId) {
      if (!find(ownerSub, connectorId)) {
        return false;
      }

      return connectors.delete(connectorId);
    },
    async addDomain(ownerSub, connectorId, domain, token) {
      const connector = find(ownerSub, connectorId);

      if (!connector || connector.domains.some((item) => item.domain === domain)) {
        return;
      }

      const record: ConsoleSsoDomainRecord = { domain, token, verifiedAt: null };
      replaceDomains(ownerSub, connectorId, (domains) => [...domains, record]);

      return record;
    },
    async markDomainVerified(ownerSub, connectorId, domain, verifiedAt) {
      replaceDomains(ownerSub, connectorId, (domains) =>
        domains.map((item) =>
          item.domain === domain ? { ...item, verifiedAt: verifiedAt.toISOString() } : item
        )
      );
    },
    async setCoreConnectorId(ownerSub, connectorId, coreConnectorId) {
      const connector = find(ownerSub, connectorId);

      if (connector) {
        connectors.set(connectorId, { ...connector, coreConnectorId });
      }
    },
  };
};
