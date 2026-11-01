type ActionsAvailability = {
  isCloud: boolean;
  actionsEnabled: boolean;
};

type ActionsQuotaData = {
  actionsEnabled?: boolean;
};

type NormalizeActionsQuotaOptions = {
  /**
   * The value to use when the Cloud response omits `actionsEnabled`.
   *
   * Omit it for entitlement-bearing subscription quotas so that a missing key surfaces
   * as an error instead of silently disabling the feature. Pass it for optional SKU
   * quotas and usage payloads, which may omit the flag and do not grant entitlements.
   */
  fallback?: boolean;
};

/**
 * Return a Cloud quota payload with a guaranteed `actionsEnabled` boolean.
 */
export const normalizeActionsQuota = <Quota extends ActionsQuotaData>(
  quota: Quota,
  { fallback }: NormalizeActionsQuotaOptions = {}
) => {
  const actionsEnabled = quota.actionsEnabled ?? fallback;

  if (typeof actionsEnabled !== 'boolean') {
    throw new TypeError('Cloud response is missing the Actions quota.');
  }

  return { ...quota, actionsEnabled };
};

export const isActionsEnabled = ({ isCloud, actionsEnabled }: ActionsAvailability) =>
  !isCloud || actionsEnabled;
