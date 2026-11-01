import { useLogto } from '@logto/react';
import type { ReactElement } from 'react';
import { useEffect } from 'react';

import { accountCenterBasePath } from '@ac/utils/account-center-route';

/**
 * Keep children untouched but throw Logto errors so upper error boundary can handle them.
 */
const LogtoErrorBoundary = ({ children }: { readonly children: ReactElement }) => {
  const { error } = useLogto();
  const { pathname, search } = window.location;
  const parameters = new URLSearchParams(search);
  // Callback owns SDK errors and explicit recovery. Throwing here would replace it
  // with SessionExpired, whose mount effect automatically starts another login.
  const isCallback =
    [accountCenterBasePath, `${accountCenterBasePath}/`].includes(pathname) &&
    (parameters.has('code') || parameters.has('error'));

  useEffect(() => {
    if (error && !isCallback) {
      throw error;
    }
  }, [error, isCallback]);

  return children;
};

export default LogtoErrorBoundary;
