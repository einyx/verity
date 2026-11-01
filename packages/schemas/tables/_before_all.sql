/* This SQL will run before all other queries. */

/*
  The parent role is cluster-wide and outlives the database it was created for, so a seed that
  failed part way through leaves it behind. Creating it again would fail, so the role is created
  only when it is missing and its password is set either way: the tenant roles inherit from it
  and the runtime connects with the tenant's own role.
*/
do $before_all$
begin
  if not exists (select 1 from pg_roles where rolname = 'logto_tenant_${database}') then
    execute format(
      'create role %I password %L noinherit',
      'logto_tenant_${database}',
      '${password}'
    );
  end if;
end
$before_all$;

alter role logto_tenant_${database} with password '${password}' noinherit;
