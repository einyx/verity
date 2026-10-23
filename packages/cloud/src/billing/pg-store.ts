/* eslint-disable @typescript-eslint/ban-types -- Lookups return null for a missing row; the store contract and its callers rely on that. */
import { adminTenantId, getTenantOrganizationId } from '@logto/schemas';
import { type CommonQueryMethods, sql } from '@silverhand/slonik';
import { z } from 'zod';

import { findTenantForCloudClient } from './cloud-client.js';
import { isEndedStatus } from './entitlement.js';
import { type InvitationRecord, invitationStatusGuard } from './invitation.js';
import { invoiceGuard, type Invoice } from './invoice.js';
import { skuGuard, type Sku, type SkuType } from './sku.js';
import { type AdminCustomer, type BillingStore, type TenantRole } from './store.js';
import { subscriptionGuard, type Subscription } from './subscription.js';

const invitationRow = z.object({
  id: z.string(),
  tenant_id: z.string(),
  invitee: z.string(),
  inviter_sub: z.string(),
  token_hash: z.string(),
  status: invitationStatusGuard,
  created_at: z.coerce.date(),
  expires_at: z.coerce.date(),
});

const toInvitationRecord = (row: z.infer<typeof invitationRow>): InvitationRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  invitee: row.invitee,
  inviterSub: row.inviter_sub,
  tokenHash: row.token_hash,
  status: row.status,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

const invoiceRow = z.object({
  id: z.string(),
  status: z.string().nullable(),
  subscription_id: z.string().nullable(),
  customer_id: z.string().nullable(),
  basic_sku_id: z.string().nullable(),
  sku_id: z.string().nullable(),
  billing_reason: z.string().nullable(),
  amount_due: z.number(),
  amount_paid: z.number(),
  period_start: z.coerce.date(),
  period_end: z.coerce.date(),
  service_period_start: z.coerce.date().nullable(),
  service_period_end: z.coerce.date().nullable(),
  due_date: z.coerce.date().nullable(),
  plan_name: z.string().nullable(),
  hosted_invoice_url: z.string().nullable(),
  invoice_pdf: z.string().nullable(),
  collection_method: z.string().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

const skuRow = z.object({
  type: z.string(),
  id: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  name: z.string().nullable(),
  default_price_id: z.string().nullable(),
  unit_price: z.union([z.number(), z.string()]).nullable(),
  quota: z.record(z.unknown()),
});

const subscriptionRow = z.object({
  plan_id: z.string(),
  status: z.string(),
  is_enterprise_plan: z.boolean(),
  is_dev_plan: z.boolean(),
  has_billing_customer: z.boolean(),
  // Slonik returns `timestamptz` as epoch milliseconds, so coerce rather than expect a `Date`.
  current_period_start: z.coerce.date(),
  current_period_end: z.coerce.date(),
  quota: z.record(z.unknown()),
  system_limit: z.record(z.unknown()),
});

/**
 * Reads billing data from the `meshx_cloud` database. Rows are parsed with the same guards the
 * routes respond with, so a row that drifts from the contract fails here instead of reaching a
 * customer's console.
 */
export const createPgBillingStore = (pool: CommonQueryMethods): BillingStore => ({
  findTenantForCloudClient: async (clientId) => findTenantForCloudClient(pool, clientId),
  findSubscription: async (tenantId): Promise<Subscription | null> => {
    const row = await pool.maybeOne(sql`
      select plan_id, status, is_enterprise_plan, is_dev_plan, has_billing_customer,
        current_period_start, current_period_end, quota, system_limit
      from billing_subscriptions
      where tenant_id = ${tenantId}
    `);

    if (!row) {
      return null;
    }

    const parsed = subscriptionRow.parse(row);

    return subscriptionGuard.parse({
      planId: parsed.plan_id,
      status: parsed.status,
      isEnterprisePlan: parsed.is_enterprise_plan,
      isDevPlan: parsed.is_dev_plan,
      hasBillingCustomer: parsed.has_billing_customer,
      currentPeriodStart: parsed.current_period_start.toISOString(),
      currentPeriodEnd: parsed.current_period_end.toISOString(),
      quota: parsed.quota,
      systemLimit: parsed.system_limit,
    });
  },
  listSkus: async ({ type }): Promise<Sku[]> => {
    const rows = await pool.any(sql`
      select type, id, created_at, updated_at, name, default_price_id, unit_price, quota
      from billing_skus
      where ${type ?? null}::varchar is null or type = ${type ?? null}::varchar
      order by id
    `);

    return rows.map((row) => {
      const parsed = skuRow.parse(row);

      return skuGuard.parse({
        // eslint-disable-next-line no-restricted-syntax -- The column is constrained to the SKU type values by the schema, so the cast only narrows the string to the enum.
        type: parsed.type as SkuType,
        id: parsed.id,
        createdAt: parsed.created_at,
        updatedAt: parsed.updated_at,
        name: parsed.name,
        defaultPriceId: parsed.default_price_id,
        // Postgres `numeric` comes back as a string, so normalise it before the guard.
        unitPrice: parsed.unit_price === null ? null : Number(parsed.unit_price),
        quota: parsed.quota,
      });
    });
  },
  listInvoices: async (tenantId): Promise<Invoice[]> => {
    const rows = await pool.any(sql`
      select id, status, subscription_id, customer_id, basic_sku_id, sku_id, billing_reason,
        amount_due, amount_paid, period_start, period_end, service_period_start,
        service_period_end, due_date, plan_name, hosted_invoice_url, invoice_pdf,
        collection_method, created_at, updated_at
      from billing_invoices
      where tenant_id = ${tenantId}
      order by period_start desc, id desc
    `);

    return rows.map((row) => {
      const parsed = invoiceRow.parse(row);

      return invoiceGuard.parse({
        id: parsed.id,
        status: parsed.status,
        subscriptionId: parsed.subscription_id,
        customerId: parsed.customer_id,
        basicSkuId: parsed.basic_sku_id,
        skuId: parsed.sku_id,
        billingReason: parsed.billing_reason,
        amountDue: parsed.amount_due,
        amountPaid: parsed.amount_paid,
        periodStart: parsed.period_start,
        periodEnd: parsed.period_end,
        servicePeriodStart: parsed.service_period_start,
        servicePeriodEnd: parsed.service_period_end,
        dueDate: parsed.due_date,
        planName: parsed.plan_name,
        hostedInvoiceUrl: parsed.hosted_invoice_url,
        invoicePdf: parsed.invoice_pdf,
        collectionMethod: parsed.collection_method,
        createdAt: parsed.created_at,
        updatedAt: parsed.updated_at,
      });
    });
  },
  /**
   * Reads the caller's role from the tenant's Logto organization, the same record the console uses.
   * The admin role id is `admin` (`TenantRole.Admin`); any other organization role reads as `member`.
   */
  findMembership: async (tenantId, identity): Promise<TenantRole | null> => {
    const rows = await pool.any(sql`
      select organization_role_id as role
      from organization_role_user_relations
      where tenant_id = ${adminTenantId}
        and organization_id = ${getTenantOrganizationId(tenantId)}
        and user_id = ${identity.sub}
    `);

    if (rows.length === 0) {
      return null;
    }

    return rows.some((row) => row.role === 'admin') ? 'admin' : 'member';
  },
  listInvitations: async (tenantId): Promise<InvitationRecord[]> => {
    const rows = await pool.any(sql`
      select id, tenant_id, invitee, inviter_sub, token_hash, status, created_at, expires_at
      from tenant_invitations
      where tenant_id = ${tenantId}
      order by created_at desc, id desc
    `);

    return rows.map((row) => toInvitationRecord(invitationRow.parse(row)));
  },
  findInvitation: async (id): Promise<InvitationRecord | null> => {
    const row = await pool.maybeOne(sql`
      select id, tenant_id, invitee, inviter_sub, token_hash, status, created_at, expires_at
      from tenant_invitations
      where id = ${id}
    `);

    return row ? toInvitationRecord(invitationRow.parse(row)) : null;
  },
  createInvitation: async (record): Promise<void> => {
    await pool.query(sql`
      insert into tenant_invitations (
        id, tenant_id, invitee, inviter_sub, token_hash, status, created_at, expires_at
      ) values (
        ${record.id}, ${record.tenantId}, ${record.invitee}, ${record.inviterSub},
        ${record.tokenHash}, ${record.status}, ${record.createdAt.toISOString()},
        ${record.expiresAt.toISOString()}
      )
    `);
  },
  setInvitationStatus: async (id, status): Promise<void> => {
    await pool.query(sql`
      update tenant_invitations set status = ${status} where id = ${id}
    `);
  },
  claimStripeEvent: async (eventId, type): Promise<boolean> => {
    const row = await pool.maybeOne(sql`
      insert into billing_stripe_events (event_id, type)
      values (${eventId}, ${type})
      on conflict (event_id) do nothing
      returning event_id
    `);

    return row !== null;
  },
  releaseStripeEvent: async (eventId): Promise<void> => {
    await pool.query(sql`
      delete from billing_stripe_events where event_id = ${eventId}
    `);
  },
  activateStripeSubscription: async (activation): Promise<void> => {
    // The quota snapshot is copied from the SKU so reads do not need to join the catalogue. An
    // unknown plan makes the quota null, which violates the not-null constraint and fails the
    // webhook loudly instead of storing an empty quota.
    await pool.query(sql`
      insert into billing_subscriptions (
        tenant_id, plan_id, status, is_enterprise_plan, is_dev_plan, has_billing_customer,
        current_period_start, current_period_end, quota, system_limit,
        stripe_customer_id, stripe_subscription_id
      ) values (
        ${activation.tenantId}, ${activation.planId}, ${activation.status}, false, false, true,
        ${activation.periodStart.toISOString()}, ${activation.periodEnd.toISOString()},
        (select quota from billing_skus where id = ${activation.planId}),
        '{}'::jsonb, ${activation.stripeCustomerId}, ${activation.stripeSubscriptionId}
      )
      on conflict (tenant_id) do update set
        plan_id = excluded.plan_id,
        status = excluded.status,
        has_billing_customer = true,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        quota = excluded.quota,
        stripe_customer_id = excluded.stripe_customer_id,
        stripe_subscription_id = excluded.stripe_subscription_id
    `);
  },
  findDefaultCustomerId: async (identity): Promise<string | null> => {
    const row = await pool.maybeOne(sql`
      select customer_id from billing_user_default_customers
      where member_issuer = ${identity.issuer} and member_sub = ${identity.sub}
    `);

    return row ? String(row.customer_id) : null;
  },
  setDefaultCustomerId: async (identity, customerId): Promise<void> => {
    await pool.query(sql`
      insert into billing_user_default_customers (member_issuer, member_sub, customer_id)
      values (${identity.issuer}, ${identity.sub}, ${customerId})
      on conflict (member_issuer, member_sub) do update set
        customer_id = excluded.customer_id, updated_at = now()
    `);
  },
  listAdminCustomers: async (identity): Promise<AdminCustomer[]> => {
    const rows = await pool.any(sql`
      select b.tenant_id, b.stripe_customer_id, b.current_period_start
      from organization_role_user_relations r
      join billing_subscriptions b on r.organization_id = 't-' || b.tenant_id
      where r.tenant_id = ${adminTenantId}
        and r.user_id = ${identity.sub}
        and r.organization_role_id = 'admin'
        and b.stripe_customer_id is not null
      order by b.tenant_id
    `);

    return rows.map((row) => ({
      tenantId: String(row.tenant_id),
      customerId: String(row.stripe_customer_id),
      periodStart: new Date(String(row.current_period_start)),
    }));
  },
  setStripeCustomerId: async (tenantId, customerId): Promise<void> => {
    await pool.query(sql`
      update billing_subscriptions set stripe_customer_id = ${customerId}
      where tenant_id = ${tenantId}
    `);
  },
  findStripeCustomerId: async (tenantId): Promise<string | null> => {
    const row = await pool.maybeOne(sql`
      select stripe_customer_id from billing_subscriptions where tenant_id = ${tenantId}
    `);

    return row?.stripe_customer_id ? String(row.stripe_customer_id) : null;
  },
  updateStripeSubscription: async (update): Promise<void> => {
    // The period end only moves forward, so an older event cannot overwrite a newer period. An ended
    // subscription stays ended: a paid status arriving late cannot restore it.
    await pool.query(sql`
      update billing_subscriptions
      set status = ${update.status},
        current_period_start = ${update.periodStart.toISOString()},
        current_period_end = ${update.periodEnd.toISOString()}
      where stripe_subscription_id = ${update.stripeSubscriptionId}
        and current_period_end <= ${update.periodEnd.toISOString()}
        and (
          status not in ('canceled', 'incomplete_expired')
          or ${isEndedStatus(update.status)}
        )
    `);
  },
});

/* eslint-enable @typescript-eslint/ban-types */
