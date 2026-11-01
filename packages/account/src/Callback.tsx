import { useHandleSignInCallback, useLogto } from '@logto/react';
import { useEffect } from 'react';

import { clearVerificationRecord } from './Providers/PageContextProvider/verification-storage';
import ErrorPage from './components/ErrorPage';
import GlobalLoading from './components/GlobalLoading';

export const CallbackError = () => (
  <ErrorPage
    titleKey="error.something_went_wrong"
    action={{
      titleKey: 'action.sign_in',
      onClick: () => {
        window.location.replace('/account');
      },
    }}
  />
);

const Callback = () => {
  const { clearAllTokens } = useLogto();

  useEffect(() => {
    void clearAllTokens();
    clearVerificationRecord();
  }, [clearAllTokens]);

  const { error } = useHandleSignInCallback(() => {
    window.location.replace('/account');
  });

  if (error) {
    return <CallbackError />;
  }

  return <GlobalLoading />;
};

export default Callback;
