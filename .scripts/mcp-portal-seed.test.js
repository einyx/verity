import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import pg from "pg";

const tables = ["mcp_portals", "mcp_portal_upstreams"];
const readSql = (name) =>
  readFile(
    new URL(`../packages/schemas/tables/${name}.sql`, import.meta.url),
    "utf8",
  );
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;

test("fresh MCP portal seeds enforce tenant isolation through the seed lifecycle", async () => {
  assert.ok(
    process.env.DB_URL,
    "Set DB_URL explicitly to a disposable PostgreSQL database",
  );
  const client = new pg.Client({ connectionString: process.env.DB_URL });
  const suffix = randomUUID().replaceAll("-", "");
  const schema = `mcp_seed_${suffix}`;
  const roleA = `mcp_a_${suffix}`;
  const roleB = `mcp_b_${suffix}`;
  const portalId = randomUUID();
  const otherPortalId = randomUUID();

  await client.connect();
  try {
    await client.query("begin");
    await client.query(`
      create schema ${identifier(schema)};
      set local search_path to ${identifier(schema)}, pg_catalog;
      create role ${identifier(roleA)} nologin nosuperuser nobypassrls;
      create role ${identifier(roleB)} nologin nosuperuser nobypassrls;
      grant ${identifier(roleA)}, ${identifier(roleB)} to current_user;
      grant usage on schema ${identifier(schema)} to ${identifier(roleA)}, ${identifier(roleB)};
      create table tenants (id varchar(21) primary key, db_user text not null unique);
    `);
    await client.query("insert into tenants values ($1, $2), ($3, $4)", [
      "tenant-a",
      roleA,
      "tenant-b",
      roleB,
    ]);
    // Match the production function, including its explicit-tenant preservation behavior.
    await client.query(`
      create function set_tenant_id() returns trigger as $$ begin
        if new.tenant_id is not null then
          return new;
        end if;
        select tenants.id into new.tenant_id from tenants where tenants.db_user = current_user;
        return new;
      end; $$ language plpgsql;
    `);

    const lifecycle = await readSql("_after_each");
    for (const table of tables) {
      const sql = await readSql(table);
      await client.query(sql);
      // Follow the CLI seed's opt-out rule instead of installing RLS unconditionally.
      if (!sql.includes("/* no_after_each */")) {
        await client.query(lifecycle.replaceAll("${name}", table));
      }

      const { rows: columns } = await client.query(
        `
        select data_type, character_maximum_length, is_nullable
        from information_schema.columns
        where table_schema = $1 and table_name = $2 and column_name = 'tenant_id'
      `,
        [schema, table],
      );
      assert.deepEqual(
        columns,
        [
          {
            data_type: "character varying",
            character_maximum_length: 21,
            is_nullable: "NO",
          },
        ],
        `${table} must have the canonical tenant column`,
      );
      const { rows: constraints } = await client.query(
        `
        select confupdtype, confdeltype from pg_constraint
        where conrelid = $1::regclass and confrelid = 'tenants'::regclass and contype = 'f'
      `,
        [table],
      );
      assert.deepEqual(constraints, [{ confupdtype: "c", confdeltype: "c" }]);
      const { rows: indexes } = await client.query(
        `
        select indexname from pg_indexes
        where schemaname = $1 and tablename = $2 and indexname = $3
      `,
        [schema, table, `${table}__tenant_id`],
      );
      assert.equal(indexes.length, 1, `${table} must index tenant_id`);
      const { rows: security } = await client.query(
        "select relrowsecurity from pg_class where oid = $1::regclass",
        [table],
      );
      assert.equal(security[0].relrowsecurity, true);
      const { rows: policies } = await client.query(
        `
        select policyname, permissive, cmd from pg_policies
        where schemaname = $1 and tablename = $2 order by policyname
      `,
        [schema, table],
      );
      assert.deepEqual(policies, [
        {
          policyname: `${table}_modification`,
          permissive: "PERMISSIVE",
          cmd: "ALL",
        },
        {
          policyname: `${table}_tenant_id`,
          permissive: "RESTRICTIVE",
          cmd: "ALL",
        },
      ]);
      await client.query(`grant select, insert, update, delete on ${table}
        to ${identifier(roleA)}, ${identifier(roleB)}`);
    }
    await client.query(
      `grant select on tenants to ${identifier(roleA)}, ${identifier(roleB)}`,
    );

    // Fresh installs skip historical alterations, so the seed must support the real stores too.
    await client.query(await readSql("mcp_portal_settings"));
    await client.query(
      (await readSql("_after_each")).replaceAll("${name}", "mcp_portal_settings"),
    );
    await client.query(`grant select, insert, update, delete on mcp_portal_settings
      to ${identifier(roleA)}, ${identifier(roleB)}`);
    const { PostgresPortalSettingsStore } = await import(
      "../packages/mcp-portal/lib/postgres-settings.js"
    );
    const { PostgresUpstreamStore } = await import(
      "../packages/mcp-portal/lib/postgres-registry.js"
    );
    const query = (token) => client.query(token.sql, token.values);
    const pool = {
      query,
      maybeOne: async (token) => (await query(token)).rows[0] ?? null,
      any: async (token) => (await query(token)).rows,
    };
    const settings = new PostgresPortalSettingsStore(pool);
    const upstreams = new PostgresUpstreamStore(pool);

    const insertPortal = (id, tenantId) =>
      client.query(
        `
      insert into mcp_portals (id, name, hostname, tenant_id) values ($1, 'Portal', $2, $3)
      returning tenant_id
    `,
        [id, `${id}.example.test`, tenantId],
      );
    const insertUpstream = (id, tenantId) =>
      client.query(
        `
      insert into mcp_portal_upstreams (portal_id, name, url, tenant_id)
      values ($1, 'upstream', 'https://example.test/mcp', $2) returning tenant_id
    `,
        [id, tenantId],
      );

    await client.query(`set local role ${identifier(roleA)}`);
    for (const insert of [insertPortal, insertUpstream]) {
      assert.deepEqual((await insert(portalId, null)).rows, [
        { tenant_id: "tenant-a" },
      ]);
    }
    assert.deepEqual(await settings.get(), {});
    assert.deepEqual(await settings.setBaseDomain("a.example.test"), {
      baseDomain: "a.example.test",
    });
    assert.deepEqual(await settings.setBaseDomain("updated.example.test"), {
      baseDomain: "updated.example.test",
    });
    assert.equal(await upstreams.findCredential(portalId, "upstream"), undefined);
    assert.equal(await upstreams.setCredential(portalId, "upstream", "ciphertext"), true);
    assert.equal(await upstreams.findCredential(portalId, "upstream"), "ciphertext");

    await client.query(`set local role ${identifier(roleB)}`);
    assert.deepEqual(await settings.get(), {});
    assert.deepEqual(await settings.setBaseDomain("b.example.test"), {
      baseDomain: "b.example.test",
    });
    assert.equal(await upstreams.findCredential(portalId, "upstream"), undefined);
    assert.equal(await upstreams.setCredential(portalId, "upstream", "other"), false);
    for (const table of tables) {
      assert.equal((await client.query(`select * from ${table}`)).rowCount, 0);
      assert.equal(
        (await client.query(`update ${table} set name = 'changed'`)).rowCount,
        0,
      );
      assert.equal((await client.query(`delete from ${table}`)).rowCount, 0);
    }
    for (const insert of [insertPortal, insertUpstream]) {
      await client.query("savepoint tenant_injection");
      await assert.rejects(insert(otherPortalId, "tenant-a"), {
        code: "42501",
      });
      await client.query("rollback to savepoint tenant_injection");
      await client.query("release savepoint tenant_injection");
      assert.deepEqual((await insert(otherPortalId, null)).rows, [
        { tenant_id: "tenant-b" },
      ]);
    }

    for (const table of tables) {
      await client.query("savepoint tenant_transfer");
      await assert.rejects(
        client.query(`update ${table} set tenant_id = $1`, ["tenant-a"]),
        { code: "42501" },
      );
      await client.query("rollback to savepoint tenant_transfer");
      await client.query("release savepoint tenant_transfer");
    }

    await client.query(`set local role ${identifier(roleA)}`);
    assert.deepEqual(await settings.get(), { baseDomain: "updated.example.test" });
    assert.equal(await upstreams.findCredential(portalId, "upstream"), "ciphertext");
    for (const table of tables) {
      assert.deepEqual(
        (await client.query(`select name, tenant_id from ${table}`)).rows,
        [
          {
            name: table === "mcp_portals" ? "Portal" : "upstream",
            tenant_id: "tenant-a",
          },
        ],
      );
    }
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
});
