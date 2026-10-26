import {
  adminTenantId,
  CloudScope,
  defaultLandingPageContent,
  getCloudApiIndicator,
  landingPageDocumentGuard,
  type LandingPageDocument,
  PredefinedScope,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import type { Nullable } from '@silverhand/essentials';
import { sql } from '@silverhand/slonik';
import type { Context } from 'koa';
import Router from 'koa-router';
import { z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { verifyBearerTokenFromRequest } from '#src/middleware/koa-auth/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import assertThat from '#src/utils/assert-that.js';

// Landing page CMS for the marketing site. The public read returns only the published document; the
// editor routes need a Cloud API token carrying `manage:landing:page`. Mounted on the admin tenant
// only. Each publish keeps an immutable version row for rollback. Until
// something is saved, the draft is the shipped default copy.

type PageRow = {
  draft: LandingPageDocument;
  published: Nullable<LandingPageDocument>;
  publishedVersion: Nullable<number>;
  updatedAt?: string;
};

const publishBody = z.object({
  /** The draft's updated time as the editor last saw it. Publish refuses when it is behind, so one
   * editor cannot silently publish another editor's newer content. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

type VersionRow = {
  version: number;
  document: LandingPageDocument;
  publishedBy: string;
  createdAt: string | number | Date;
};

const rollbackBody = z.object({ version: z.number().int().positive() });

export const landingPageRoutes = (envSet: EnvSet) => {
  const router = new Router();

  // The editor uses the same Cloud API audience as the tenant routes, so a token is only accepted when
  // it was issued for this instance's cloud API resource.
  const authenticateEditor = async (ctx: Context) => {
    const audience = getCloudApiIndicator(EnvSet.values.cloudUrlSet.endpoint.origin);
    const { sub, clientId, scopes } = await verifyBearerTokenFromRequest(
      envSet,
      ctx.request,
      audience
    );

    assertThat(
      scopes.includes(PredefinedScope.All) || scopes.includes(CloudScope.ManageLandingPage),
      new RequestError({ code: 'auth.forbidden', status: 403 })
    );
    // A machine token has no user to attribute the publish to.
    assertThat(sub !== clientId, new RequestError({ code: 'auth.forbidden', status: 403 }));

    return sub;
  };

  const readPage = async (): Promise<PageRow> => {
    const pool = await EnvSet.sharedPool;
    const row = await pool.maybeOne<{
      draft: LandingPageDocument;
      published: Nullable<LandingPageDocument>;
      publishedVersion: Nullable<number>;
      updatedAt: Date | string | undefined;
    }>(sql`
      select
        draft,
        published,
        published_version as "publishedVersion",
        updated_at as "updatedAt"
      from landing_pages
      where tenant_id = ${adminTenantId}
    `);

    if (!row) {
      return { draft: defaultLandingPageContent, published: null, publishedVersion: null };
    }

    return {
      draft: landingPageDocumentGuard.parse(row.draft),
      published: row.published && landingPageDocumentGuard.parse(row.published),
      publishedVersion: row.publishedVersion,
      // The driver hands the timestamp back as a Date or as a string; the editor compares it as an
      // ISO string, so normalize both shapes instead of assuming one.
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : row.updatedAt?.toISOString(),
    };
  };

  const readPublishedPage = async () => {
    const pool = await EnvSet.sharedPool;
    const row = await pool.maybeOne<Pick<PageRow, 'published' | 'publishedVersion'>>(sql`
      select published, published_version as "publishedVersion"
      from landing_pages
      where tenant_id = ${adminTenantId}
    `);

    return {
      published: row?.published ? landingPageDocumentGuard.parse(row.published) : null,
      publishedVersion: row?.publishedVersion ?? null,
    };
  };

  // Public read for the marketing site. Only the published document is exposed, never the draft.
  router.get('/api/landing-page', koaGuard({ status: [200, 304] }), async (ctx, next) => {
    ctx.body = await readPublishedPage();

    return next();
  });

  router.get(
    '/api/landing-page/editor',
    koaGuard({ status: [200, 304, 401, 403] }),
    async (ctx, next) => {
      await authenticateEditor(ctx);
      ctx.body = await readPage();

      return next();
    }
  );

  // Saves the draft only. Nothing reaches the marketing site until it is published.
  router.put(
    '/api/landing-page/draft',
    koaGuard({ body: landingPageDocumentGuard, status: [200, 400, 401, 403] }),
    async (ctx, next) => {
      await authenticateEditor(ctx);
      const pool = await EnvSet.sharedPool;

      await pool.query(sql`
        insert into landing_pages (id, tenant_id, draft)
        values (${generateStandardId()}, ${adminTenantId}, ${sql.jsonb(ctx.guard.body)})
        on conflict (tenant_id) do update
        set draft = excluded.draft, updated_at = now()
      `);
      ctx.body = await readPage();

      return next();
    }
  );

  // Copies the current draft into a new published version. The version number is assigned from the
  // history inside the transaction, so concurrent publishes cannot reuse one.
  router.post(
    '/api/landing-page/publish',
    koaGuard({ body: publishBody, status: [200, 401, 403, 404, 409] }),
    async (ctx, next) => {
      const userId = await authenticateEditor(ctx);
      const pool = await EnvSet.sharedPool;

      const page = await readPage();
      const { expectedUpdatedAt } = ctx.guard.body;

      // The editor sends the draft time it last saw. When it is behind, someone else saved in the
      // meantime: refuse rather than silently publish their content.
      assertThat(
        !expectedUpdatedAt || !page.updatedAt || expectedUpdatedAt === page.updatedAt,
        new RequestError({ code: 'entity.edit_conflict', status: 409 })
      );

      await pool.transaction(async (transaction) => {
        const { latest } = await transaction.one<{ latest: number }>(sql`
          select coalesce(max(version), 0)::integer as latest
          from landing_page_versions
          where tenant_id = ${adminTenantId}
        `);
        const version = latest + 1;

        await transaction.query(sql`
          insert into landing_page_versions (id, tenant_id, version, document, published_by)
          values (
            ${generateStandardId()}, ${adminTenantId}, ${version},
            ${sql.jsonb(page.draft)}, ${userId}
          )
        `);
        await transaction.query(sql`
          update landing_pages
          set published = ${sql.jsonb(page.draft)},
            published_version = ${version},
            updated_at = now()
          where tenant_id = ${adminTenantId}
        `);
      });

      ctx.body = await readPage();

      return next();
    }
  );

  // Points the published document back at an earlier version. The history is kept as it is, and the
  // draft is left alone so editors can keep working on it.
  router.post(
    '/api/landing-page/rollback',
    koaGuard({ body: rollbackBody, status: [200, 400, 401, 403, 404] }),
    async (ctx, next) => {
      await authenticateEditor(ctx);
      const pool = await EnvSet.sharedPool;

      const target = await pool.maybeOne<{ document: LandingPageDocument; version: number }>(sql`
        select document, version
        from landing_page_versions
        where tenant_id = ${adminTenantId} and version = ${ctx.guard.body.version}
      `);
      assertThat(target, new RequestError({ code: 'entity.not_found', status: 404 }));
      const document = landingPageDocumentGuard.parse(target.document);

      await pool.query(sql`
        update landing_pages
        set published = ${sql.jsonb(document)},
          published_version = ${target.version},
          updated_at = now()
        where tenant_id = ${adminTenantId}
      `);
      ctx.body = await readPage();

      return next();
    }
  );

  router.get(
    '/api/landing-page/versions',
    koaGuard({ status: [200, 304, 401, 403] }),
    async (ctx, next) => {
      await authenticateEditor(ctx);
      const pool = await EnvSet.sharedPool;

      const rows = await pool.any<VersionRow>(sql`
        select
          version,
          document,
          published_by as "publishedBy",
          created_at as "createdAt"
        from landing_page_versions
        where tenant_id = ${adminTenantId}
        order by version desc
      `);
      ctx.body = rows.map((row) => ({
        version: row.version,
        document: landingPageDocumentGuard.parse(row.document),
        publishedBy: row.publishedBy,
        createdAt: new Date(row.createdAt).toISOString(),
      }));

      return next();
    }
  );

  return router;
};
