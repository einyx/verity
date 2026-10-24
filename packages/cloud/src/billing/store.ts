/* eslint-disable @typescript-eslint/ban-types -- Lookups return null for a missing row; the store contract and its callers rely on that. */
import { isEndedStatus } from './entitlement.js';
import { type InvitationRecord } from './invitation.js';
import { type Invoice } from './invoice.js';
import { type Sku, type SkuType } from './sku.js';
import { logtoSkuQuotaGuard, type Subscription } from './subscription.js';

/** A tenant member's role. Admins can manage the tenant's members and invitations. */
export type TenantRole = 'admin' | 'member';

export type MemberIdentity = {
  issuer: string;
  sub: string;
};

/** The paid subscription that a Stripe checkout produced for a tenant. */
export type StripeActivation = {
  tenantId: string;
  planId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: Subscription['status'];
  periodStart: Date;
  periodEnd: Date;
};

/** A tenant's Stripe customer, as the user who administers that tenant may see it. */
export type AdminCustomer = {
  tenantId: string;
  customerId: string;
  periodStart: Date;
};

/** A status and period change that Stripe reported for one of its subscriptions. */
export type StripeSubscriptionUpdate = {
  stripeSubscriptionId: string;
  status: Subscription['status'];
  periodStart: Date;
  periodEnd: Date;
};

/**
 * Read and write access to billing, membership, and invitation data. The Postgres implementation
 * reads and writes the `meshx_cloud` database; the in-memory one exists for tests only.
 */
export type BillingStore = {
  /** The subscription of a tenant, or `null` when the tenant has none on record. */
  findSubscription: (tenantId: string) => Promise<Subscription | null>;
  /** The SKUs in the catalogue, optionally filtered by type. */
  listSkus: (filter: { type?: SkuType }) => Promise<Sku[]>;
  /** The invoices of a tenant, newest first. */
  listInvoices: (tenantId: string) => Promise<Invoice[]>;
  /** The caller's role in a tenant, or `null` when they are not a member of it. */
  findMembership: (tenantId: string, identity: MemberIdentity) => Promise<TenantRole | null>;
  /** Resolves a provisioned tenant cloud M2M client to its tenant, or null if it is not one. */
  findTenantForCloudClient: (clientId: string) => Promise<string | undefined>;
  /** The invitations of a tenant, newest first. */
  listInvitations: (tenantId: string) => Promise<InvitationRecord[]>;
  /** One invitation by id, or `null` when there is none. */
  findInvitation: (id: string) => Promise<InvitationRecord | null>;
  /** Stores a new invitation. */
  createInvitation: (record: InvitationRecord) => Promise<void>;
  /** Moves an invitation to a new status. */
  setInvitationStatus: (id: string, status: InvitationRecord['status']) => Promise<void>;
  /**
   * Claims a Stripe event before it is processed. Returns `false` when the event was already
   * claimed, so a redelivered event is not applied twice.
   */
  claimStripeEvent: (eventId: string, type: string) => Promise<boolean>;
  /** Drops a claim so that Stripe's next delivery of the event is processed. */
  releaseStripeEvent: (eventId: string) => Promise<void>;
  /** The Stripe customers of the tenants this identity administers, one per tenant with a customer. */
  listAdminCustomers: (identity: MemberIdentity) => Promise<AdminCustomer[]>;
  /** The customer this user picked as their default, or `null` when none was picked. */
  findDefaultCustomerId: (identity: MemberIdentity) => Promise<string | null>;
  /** Records the customer this user picked as their default. */
  setDefaultCustomerId: (identity: MemberIdentity, customerId: string) => Promise<void>;
  /** Sets or clears the Stripe customer recorded for a tenant. */
  setStripeCustomerId: (tenantId: string, customerId: string | null) => Promise<void>;
  /** The Stripe customer of a tenant's paid subscription, or `null` when none was recorded. */
  findStripeCustomerId: (tenantId: string) => Promise<string | null>;
  /** Makes a tenant's subscription the paid Stripe subscription. Creates it when missing. */
  activateStripeSubscription: (activation: StripeActivation) => Promise<void>;
  /** Applies a status and period from Stripe. Does nothing when no subscription has that Stripe id. */
  updateStripeSubscription: (update: StripeSubscriptionUpdate) => Promise<void>;
};

export const createInMemoryBillingStore = (
  data: {
    subscriptions?: Record<string, Subscription>;
    skus?: Sku[];
    invoices?: Record<string, Invoice[]>;
    members?: Record<string, Array<MemberIdentity & { role: TenantRole }>>;
    cloudClients?: Record<string, string>;
    invitations?: InvitationRecord[];
  } = {}
): BillingStore => {
  const invitations = [...(data.invitations ?? [])];
  const subscriptions = new Map(Object.entries(data.subscriptions ?? {}));
  const claimedEvents = new Set<string>();
  const tenantByStripeSubscription = new Map<string, string>();
  const stripeCustomerByTenant = new Map<string, string>();
  const defaultCustomerByUser = new Map<string, string>();

  return {
    findSubscription: async (tenantId) => subscriptions.get(tenantId) ?? null,
    listSkus: async ({ type }) =>
      (data.skus ?? []).filter((sku) => (type ? sku.type === type : true)),
    listInvoices: async (tenantId) => data.invoices?.[tenantId] ?? [],
    findMembership: async (tenantId, identity) =>
      data.members?.[tenantId]?.find(
        (member) => member.issuer === identity.issuer && member.sub === identity.sub
      )?.role ?? null,
    findTenantForCloudClient: async (clientId) => data.cloudClients?.[clientId],
    listInvitations: async (tenantId) =>
      invitations
        .filter((invitation) => invitation.tenantId === tenantId)
        .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    findInvitation: async (id) => invitations.find((invitation) => invitation.id === id) ?? null,
    createInvitation: async (record) => {
      // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- The in-memory store is the test double for the database and is mutated on purpose.
      invitations.push(record);
    },
    setInvitationStatus: async (id, status) => {
      const invitation = invitations.find((item) => item.id === id);

      if (invitation) {
        // eslint-disable-next-line @silverhand/fp/no-mutation -- The in-memory store is the test double for the database and is mutated on purpose.
        invitation.status = status;
      }
    },
    findStripeCustomerId: async (tenantId) => stripeCustomerByTenant.get(tenantId) ?? null,
    setStripeCustomerId: async (tenantId, customerId) => {
      if (customerId === null) {
        stripeCustomerByTenant.delete(tenantId);
      } else {
        stripeCustomerByTenant.set(tenantId, customerId);
      }
    },
    findDefaultCustomerId: async (identity) =>
      defaultCustomerByUser.get(`${identity.issuer}|${identity.sub}`) ?? null,
    setDefaultCustomerId: async (identity, customerId) => {
      defaultCustomerByUser.set(`${identity.issuer}|${identity.sub}`, customerId);
    },
    listAdminCustomers: async (identity) =>
      [...stripeCustomerByTenant.entries()].flatMap(([tenantId, customerId]) => {
        const isAdmin = data.members?.[tenantId]?.some(
          (member) =>
            member.role === 'admin' &&
            member.issuer === identity.issuer &&
            member.sub === identity.sub
        );
        const periodStart = subscriptions.get(tenantId)?.currentPeriodStart;

        return isAdmin && periodStart
          ? [{ tenantId, customerId, periodStart: new Date(periodStart) }]
          : [];
      }),
    claimStripeEvent: async (eventId) => {
      if (claimedEvents.has(eventId)) {
        return false;
      }

      claimedEvents.add(eventId);
      return true;
    },
    releaseStripeEvent: async (eventId) => {
      claimedEvents.delete(eventId);
    },
    activateStripeSubscription: async (activation) => {
      const sku = (data.skus ?? []).find((item) => item.id === activation.planId);

      if (!sku) {
        throw new Error(`Unknown plan ${activation.planId}.`);
      }

      tenantByStripeSubscription.set(activation.stripeSubscriptionId, activation.tenantId);
      stripeCustomerByTenant.set(activation.tenantId, activation.stripeCustomerId);
      subscriptions.set(activation.tenantId, {
        planId: activation.planId,
        status: activation.status,
        isEnterprisePlan: false,
        isDevPlan: false,
        hasBillingCustomer: true,
        currentPeriodStart: activation.periodStart.toISOString(),
        currentPeriodEnd: activation.periodEnd.toISOString(),
        quota: logtoSkuQuotaGuard.parse(sku.quota),
        systemLimit: {},
      });
    },
    updateStripeSubscription: async (update) => {
      const tenantId = tenantByStripeSubscription.get(update.stripeSubscriptionId);
      const current = tenantId ? subscriptions.get(tenantId) : undefined;

      // An older event must not overwrite a newer period, so the update is skipped when it would
      // move the period end backwards. An ended subscription stays ended, so a late paid status
      // cannot restore access after cancellation.
      if (
        !tenantId ||
        !current ||
        Date.parse(current.currentPeriodEnd) > update.periodEnd.getTime() ||
        (isEndedStatus(current.status) && !isEndedStatus(update.status))
      ) {
        return;
      }

      subscriptions.set(tenantId, {
        ...current,
        status: update.status,
        currentPeriodStart: update.periodStart.toISOString(),
        currentPeriodEnd: update.periodEnd.toISOString(),
      });
    },
  };
};

/* eslint-enable @typescript-eslint/ban-types */
