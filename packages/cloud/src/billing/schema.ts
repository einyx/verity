import { type CommonQueryMethods, sql } from '@silverhand/slonik';

/**
 * Billing tables in the `meshx_cloud` database. Billing is platform data read across every
 * customer by the operator backoffice, so these tables have no tenant row-level security; access
 * is granted to the cloud service's database role only.
 *
 * `quota` and `system_limit` on a subscription are snapshots taken when the subscription changes,
 * so a read returns the entitlements the customer bought without joining the SKU catalogue.
 */
export const billingSchemaSql = sql`
  create table if not exists billing_skus (
    id varchar(64) not null,
    type varchar(32) not null,
    name text,
    stripe_product_id text,
    default_price_id text,
    unit_price numeric,
    quota jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (id)
  );

  alter table billing_skus add column if not exists stripe_product_id text;

  -- The Pro plan that production tenants start on. Subscriptions reference it by id, so the row must exist
  -- before a subscription is read. The quota is complete, because the SKU reader requires every field.
  insert into billing_skus (id, type, name, quota)
  values (
    'pro-202509', 'Basic', 'Pro',
    '{"mauLimit":1000,"hooksLimit":1,"mfaEnabled":true,"tokenLimit":1000000,"actionsEnabled":false,"resourcesLimit":3,"userRolesLimit":10,"customJwtEnabled":false,"hostedEmailLimit":100,"applicationsLimit":20,"bringYourUiEnabled":false,"customDomainsLimit":1,"enterpriseSsoLimit":0,"organizationsLimit":3,"scopesPerRoleLimit":10,"tenantMembersLimit":10,"subjectTokenEnabled":false,"organizationsEnabled":true,"passkeySignInEnabled":false,"hostedEmailDailyLimit":10,"machineToMachineLimit":5,"samlApplicationsLimit":0,"socialConnectorsLimit":3,"auditLogsRetentionDays":7,"idpInitiatedSsoEnabled":false,"scopesPerResourceLimit":10,"securityFeaturesEnabled":false,"consoleSsoConnectorLimit":0,"collectUserProfileEnabled":false,"machineToMachineRolesLimit":10,"thirdPartyApplicationsLimit":1}'::jsonb
  )
  on conflict (id) do nothing;

  create table if not exists billing_subscriptions (
    tenant_id varchar(21) not null,
    plan_id varchar(64) not null,
    status varchar(32) not null,
    is_enterprise_plan boolean not null default false,
    is_dev_plan boolean not null default false,
    has_billing_customer boolean not null default false,
    current_period_start timestamptz not null,
    current_period_end timestamptz not null,
    quota jsonb not null default '{}'::jsonb,
    system_limit jsonb not null default '{}'::jsonb,
    primary key (tenant_id)
  );

  create table if not exists billing_invoices (
    id varchar(64) not null,
    tenant_id varchar(21) not null,
    subscription_id varchar(64),
    customer_id varchar(64),
    basic_sku_id varchar(64),
    sku_id varchar(64),
    status varchar(32),
    billing_reason varchar(64),
    amount_due integer not null default 0,
    amount_paid integer not null default 0,
    period_start timestamptz not null,
    period_end timestamptz not null,
    service_period_start timestamptz,
    service_period_end timestamptz,
    due_date timestamptz,
    plan_name text,
    hosted_invoice_url text,
    invoice_pdf text,
    collection_method varchar(32),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (id)
  );

  create index if not exists billing_invoices_tenant_id on billing_invoices (tenant_id);

  create table if not exists tenant_members (
    tenant_id varchar(21) not null,
    member_issuer text not null,
    member_sub text not null,
    role varchar(32) not null,
    created_at timestamptz not null default now(),
    primary key (tenant_id, member_issuer, member_sub)
  );

  create table if not exists tenant_invitations (
    id varchar(64) not null,
    tenant_id varchar(21) not null,
    invitee text not null,
    inviter_sub text not null,
    token_hash text not null,
    status varchar(16) not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    primary key (id)
  );

  create index if not exists tenant_invitations_tenant_id on tenant_invitations (tenant_id);

  alter table billing_subscriptions add column if not exists stripe_customer_id text;
  alter table billing_subscriptions add column if not exists stripe_subscription_id text;

  create table if not exists billing_user_default_customers (
    member_issuer text not null,
    member_sub text not null,
    customer_id varchar(255) not null,
    updated_at timestamptz not null default now(),
    primary key (member_issuer, member_sub)
  );

  create table if not exists billing_stripe_events (
    event_id varchar(255) not null,
    type varchar(128) not null,
    received_at timestamptz not null default now(),
    primary key (event_id)
  );

  -- Core refuses to start unless every business table has row-level security enabled. The
  -- cloud service's role owns these tables and bypasses RLS, so enabling it does not change access.
  alter table billing_skus enable row level security;
  alter table billing_subscriptions enable row level security;
  alter table billing_invoices enable row level security;
  alter table tenant_members enable row level security;
  alter table tenant_invitations enable row level security;
  alter table billing_user_default_customers enable row level security;
  alter table billing_stripe_events enable row level security;

  -- Seed the development plan that tenants without a subscription read as. Idempotent, so an
  -- existing row (for example one edited by an operator) is left unchanged.
  insert into billing_skus (id, type, name, quota)
  values (
    'dev',
    'Basic',
    'Development',
    '{
      "mauLimit": 1000,
      "applicationsLimit": 10,
      "thirdPartyApplicationsLimit": 1,
      "scopesPerResourceLimit": 10,
      "socialConnectorsLimit": 3,
      "userRolesLimit": 10,
      "machineToMachineRolesLimit": 10,
      "scopesPerRoleLimit": 10,
      "hooksLimit": 1,
      "auditLogsRetentionDays": 7,
      "customJwtEnabled": false,
      "actionsEnabled": false,
      "subjectTokenEnabled": false,
      "bringYourUiEnabled": false,
      "collectUserProfileEnabled": false,
      "passkeySignInEnabled": false,
      "tokenLimit": 1000000,
      "hostedEmailLimit": 100,
      "hostedEmailDailyLimit": 10,
      "machineToMachineLimit": 3,
      "resourcesLimit": 3,
      "enterpriseSsoLimit": 0,
      "consoleSsoConnectorLimit": 0,
      "tenantMembersLimit": 3,
      "mfaEnabled": true,
      "organizationsEnabled": true,
      "organizationsLimit": 3,
      "idpInitiatedSsoEnabled": false,
      "samlApplicationsLimit": 0,
      "securityFeaturesEnabled": false,
      "customDomainsLimit": 0
    }'::jsonb
  )
  on conflict (id) do nothing;
`;

export const migrateBillingSchema = async (pool: CommonQueryMethods) => {
  await pool.query(billingSchemaSql);
};
