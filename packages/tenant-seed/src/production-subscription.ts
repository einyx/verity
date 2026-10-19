import { sql, type DatabaseTransactionConnection } from '@silverhand/slonik';

// Limits for a production tenant on the Pro plan. Without a billing subscription row
// the console falls back to the Development plan, which is wrong for production tenants.
const productionProQuota = {
  mauLimit: 1000,
  tenantMembersLimit: 10,
  applicationsLimit: 20,
  machineToMachineLimit: 5,
  customDomainsLimit: 1,
};

/**
 * Create the Pro subscription a production tenant starts on, one year from now, without a billing customer.
 */
export const seedProductionSubscription = async (
  connection: DatabaseTransactionConnection,
  tenantId: string
) => {
  const quota = JSON.stringify(productionProQuota);
  await connection.query(sql`
    insert into billing_subscriptions (
      tenant_id, plan_id, status, is_enterprise_plan, is_dev_plan, has_billing_customer,
      current_period_start, current_period_end, quota, system_limit
    ) values (
      ${tenantId}, 'pro', 'active', false, false, false,
      now(), now() + interval '1 year', ${quota}::jsonb, ${quota}::jsonb
    )
  `);
};
