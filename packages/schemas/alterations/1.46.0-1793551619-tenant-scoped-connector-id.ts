import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

/**
 * Make the connector ID unique per tenant instead of globally.
 *
 * The connector ID is the last segment of a social connector's callback URI
 * (`{tenantEndpoint}/callback/{connectorId}`), and identity providers match that URI exactly. To
 * let every tenant use the same, predictable callback path (e.g. `/callback/google`) without
 * colliding in the database, the primary key has to be scoped to the tenant.
 *
 * Tenant isolation is already enforced by row-level security, so this only widens the key: the
 * connector lookup in the callback flow happens within the tenant that received the request.
 */
const alteration: AlterationScript = {
  up: async (pool) => {
    /**
     * The foreign key has to be dropped before the primary key it depends on. The referenced table
     * is scoped to the tenant as well, so the relation becomes tenant-scoped.
     */
    await pool.query(sql`
      alter table secret_social_connector_relations
        drop constraint secret_social_connector_relations_connector_id_fkey;
    `);

    await pool.query(sql`
      alter table connectors
        drop constraint connectors_pkey;
    `);

    await pool.query(sql`
      alter table connectors
        add primary key (tenant_id, id);
    `);

    await pool.query(sql`
      alter table secret_social_connector_relations
        add constraint secret_social_connector_relations_connector_id_fkey
          foreign key (connector_id, tenant_id)
          references connectors (id, tenant_id) on update cascade;
    `);
  },
  down: async (pool) => {
    await pool.query(sql`
      alter table secret_social_connector_relations
        drop constraint secret_social_connector_relations_connector_id_fkey;
    `);

    await pool.query(sql`
      alter table connectors
        drop constraint connectors_pkey;
    `);

    /**
     * The global primary key can only be restored when no two tenants share a connector ID. Any
     * such pair has to be renamed first, otherwise the constraint cannot be created.
     */
    await pool.query(sql`
      alter table connectors
        add primary key (id);
    `);

    await pool.query(sql`
      alter table secret_social_connector_relations
        add constraint secret_social_connector_relations_connector_id_fkey
          foreign key (connector_id)
          references connectors (id) on update cascade;
    `);
  },
};

export default alteration;
