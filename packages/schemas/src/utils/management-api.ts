/**
 * The pattern of Management API resource indicators, e.g. `https://default.meshx.foundation/api`. It is
 * valid in both JavaScript and PostgreSQL regular expressions.
 */
export const managementApiIndicatorPattern = String.raw`^https://[^.]+\.meshx\.foundation/api$`;

const managementApiIndicatorRegExp = new RegExp(managementApiIndicatorPattern);

export const isManagementApi = (indicator: string) => managementApiIndicatorRegExp.test(indicator);
