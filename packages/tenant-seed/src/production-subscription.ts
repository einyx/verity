import { sql, type DatabaseTransactionConnection } from '@silverhand/slonik';

/**
 * The plan new production tenants start on: Enterprise, with passkey sign-in. It mirrors the
 * `enterprise` SKU the operator provisions, so a fresh tenant's quota matches the demo tenants.
 */
export const productionEnterprisePlan = {
  planId: 'enterprise',
  isEnterprisePlan: true,
  quota: {
    mauLimit: 1000,
    tenantMembersLimit: 10,
    applicationsLimit: 20,
    machineToMachineLimit: 5,
    customDomainsLimit: 1,
    passkeySignInEnabled: true,
  },
} as const;

/**
 * Create the Enterprise subscription a production tenant starts on, one year from now, without a
 * billing customer.
 */
export const seedProductionSubscription = async (
  connection: DatabaseTransactionConnection,
  tenantId: string
) => {
  const quota = JSON.stringify(productionEnterprisePlan.quota);
  await connection.query(sql`
    insert into billing_subscriptions (
      tenant_id, plan_id, status, is_enterprise_plan, is_dev_plan, has_billing_customer,
      current_period_start, current_period_end, quota, system_limit
    ) values (
      ${tenantId}, ${productionEnterprisePlan.planId}, 'active', ${productionEnterprisePlan.isEnterprisePlan}, false, false,
      now(), now() + interval '1 year', ${quota}::jsonb, ${quota}::jsonb
    )
  `);
};
