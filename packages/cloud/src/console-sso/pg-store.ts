import { type CommonQueryMethods, sql } from '@silverhand/slonik';
import { z } from 'zod';

import { type ConsoleSsoConnectorRecord, type ConsoleSsoStore } from './store.js';
import { consoleSsoProviderGuard } from './types.js';

const connectorRow = z.object({
  id: z.string(),
  owner_sub: z.string(),
  provider: consoleSsoProviderGuard,
  display_name: z.string(),
  client_id: z.string(),
  created_at: z.coerce.date(),
  core_connector_id: z.string().nullable(),
});

const domainRow = z.object({
  connector_id: z.string(),
  domain: z.string(),
  token: z.string(),
  verified_at: z.coerce.date().nullable(),
});

type ConnectorRow = z.infer<typeof connectorRow>;
type DomainRow = z.infer<typeof domainRow>;

const toConnector = (row: ConnectorRow, domains: DomainRow[]): ConsoleSsoConnectorRecord => ({
  id: row.id,
  ownerSub: row.owner_sub,
  provider: row.provider,
  displayName: row.display_name,
  clientId: row.client_id,
  createdAt: row.created_at,
  coreConnectorId: row.core_connector_id ?? undefined,
  domains: domains.map((item) => ({
    domain: item.domain,
    token: item.token,
    verifiedAt: item.verified_at?.toISOString() ?? null,
  })),
});

/** Postgres store for Console SSO. Every query filters by owner, matching the in-memory store. */
export const createPgConsoleSsoStore = (pool: CommonQueryMethods): ConsoleSsoStore => {
  const withDomains = async (rows: ConnectorRow[]) => {
    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const domains = await pool.any(sql`
      select connector_id, domain, token, verified_at
      from console_sso_domains
      where connector_id = any(${sql.array(ids, 'varchar')})
      order by domain
    `);
    const parsed = domains.map((row) => domainRow.parse(row));

    return rows.map((row) =>
      toConnector(
        row,
        parsed.filter((item) => item.connector_id === row.id)
      )
    );
  };

  return {
    async listConnectors(ownerSub) {
      const rows = await pool.any(sql`
        select id, owner_sub, provider, display_name, client_id, created_at, core_connector_id
        from console_sso_connectors
        where owner_sub = ${ownerSub}
        order by created_at
      `);

      return withDomains(rows.map((row) => connectorRow.parse(row)));
    },
    async findConnector(ownerSub, connectorId) {
      const row = await pool.maybeOne(sql`
        select id, owner_sub, provider, display_name, client_id, created_at, core_connector_id
        from console_sso_connectors
        where id = ${connectorId} and owner_sub = ${ownerSub}
      `);

      if (!row) {
        return;
      }

      const [connector] = await withDomains([connectorRow.parse(row)]);

      return connector;
    },
    async countConnectors(ownerSub) {
      const row = await pool.one(sql`
        select count(*)::int as total
        from console_sso_connectors
        where owner_sub = ${ownerSub}
      `);

      return z.object({ total: z.number() }).parse(row).total;
    },
    async createConnector(record) {
      await pool.query(sql`
        insert into console_sso_connectors (id, owner_sub, provider, display_name, client_id, created_at)
        values (${record.id}, ${record.ownerSub}, ${record.provider}, ${record.displayName},
          ${record.clientId}, ${record.createdAt.toISOString()})
      `);

      return { ...record, domains: [] };
    },
    async deleteConnector(ownerSub, connectorId) {
      const result = await pool.query(sql`
        delete from console_sso_connectors
        where id = ${connectorId} and owner_sub = ${ownerSub}
      `);

      return result.rowCount > 0;
    },
    async addDomain(ownerSub, connectorId, domain, token) {
      const owned = await pool.maybeOne(sql`
        select id from console_sso_connectors
        where id = ${connectorId} and owner_sub = ${ownerSub}
      `);

      if (!owned) {
        return;
      }

      const result = await pool.query(sql`
        insert into console_sso_domains (connector_id, domain, token)
        values (${connectorId}, ${domain}, ${token})
        on conflict (connector_id, domain) do nothing
      `);

      return result.rowCount > 0 ? { domain, token, verifiedAt: null } : undefined;
    },
    async setCoreConnectorId(ownerSub, connectorId, coreConnectorId) {
      await pool.query(sql`
        update console_sso_connectors
        set core_connector_id = ${coreConnectorId}
        where id = ${connectorId} and owner_sub = ${ownerSub}
      `);
    },
    async markDomainVerified(ownerSub, connectorId, domain, verifiedAt) {
      await pool.query(sql`
        update console_sso_domains
        set verified_at = ${verifiedAt.toISOString()}
        where connector_id = ${connectorId} and domain = ${domain}
          and connector_id in (
            select id from console_sso_connectors where owner_sub = ${ownerSub}
          )
      `);
    },
  };
};
