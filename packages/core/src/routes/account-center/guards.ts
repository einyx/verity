import { AccountCenters, accountCenterFieldControlGuard } from '@logto/schemas';

export const getAccountCenterApiGuards = () => {
  const fields = accountCenterFieldControlGuard;

  return {
    fields,
    accountCenter: AccountCenters.guard.extend({ fields }),
  };
};
