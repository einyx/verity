import { adminTenantId } from '@logto/schemas';
import { type CommonQueryMethods, sql } from '@silverhand/slonik';

/** Resolve only Logto's provisioned tenant M2M applications, not arbitrary client metadata. */
export const findTenantForCloudClient = async (
  pool: CommonQueryMethods,
  clientId: string
): Promise<string | undefined> => {
  const rows = await pool.any(sql`
    select custom_client_metadata ->> 'tenantId' as tenant_id
    from applications a
    where a.tenant_id = ${adminTenantId}
      and a.id = ${clientId}
      and a.type = 'MachineToMachine'
      and exists (
        select 1
        from applications_roles ar
        join roles r on r.tenant_id = ar.tenant_id and r.id = ar.role_id
        where ar.tenant_id = ${adminTenantId}
          and ar.application_id = a.id
          and r.name = 'tenantApplication'
          and r.type = 'MachineToMachine'
      )
  `);
  const tenantId = rows[0]?.tenant_id;

  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
};
