/**
 * The pattern of Management API resource indicators, e.g. `https://prysm.sh/api`. It is
 * valid in both JavaScript and PostgreSQL regular expressions.
 *
 * A deployment serves every tenant from one host, so the indicator no longer carries the
 * tenant in its subdomain. The per-tenant shape is kept as an alternative so a database
 * that still holds the old indicators is recognised as well.
 */
export const managementApiIndicatorPattern = String.raw`^https://prysm\.sh/api$`;

/**
 * The legacy per-tenant indicator shape. A database that has not been migrated yet still
 * holds those, so they are recognised as Management APIs as well.
 */
const legacyManagementApiIndicatorRegExpPattern = String.raw`^https://[^.]+\.meshx\.foundation/api$`;

const managementApiIndicatorRegExp = new RegExp(managementApiIndicatorPattern);

/**
 * Whether the indicator addresses a Management API. The legacy per-tenant indicators are
 * included so an existing database keeps working until it is migrated.
 */
const legacyManagementApiIndicatorRegExp = new RegExp(legacyManagementApiIndicatorRegExpPattern);

export const isManagementApi = (indicator: string) =>
  managementApiIndicatorRegExp.test(indicator) || legacyManagementApiIndicatorRegExp.test(indicator);
