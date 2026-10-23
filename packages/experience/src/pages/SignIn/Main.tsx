import { type SignIn, type ExperienceSocialConnector, AgreeToTermsPolicy } from '@logto/schemas';
import { useContext } from 'react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import IdentifierSignInForm from '@/components/IdentifierSignInForm';
import PasswordSignInForm from '@/components/PasswordSignInForm';
import SocialSignInList from '@/containers/SocialSignInList';
import TermsAndPrivacyCheckbox from '@/containers/TermsAndPrivacyCheckbox';
import useTerms from '@/hooks/use-terms';
import { isMeshxDarkBranding } from '@/shared/utils/meshx-dark-branding';

import useIdentifierSignInMethods from '../IdentifierSignIn/use-identifier-sign-in-methods';

import styles from './index.module.scss';

type Props = {
  readonly signInMethods: SignIn['methods'];
  readonly socialConnectors: ExperienceSocialConnector[];
};

const Main = ({ signInMethods, socialConnectors }: Props) => {
  const { agreeToTermsPolicy } = useTerms();
  const { experienceSettings } = useContext(PageContext);
  const { isPasswordOnly } = useIdentifierSignInMethods();
  const isMeshxDark =
    experienceSettings !== undefined && isMeshxDarkBranding(experienceSettings.color);

  if (isMeshxDark) {
    return (
      <>
        <header className={styles.meshxHeader}>
          <h2>Welcome back</h2>
          <p>Please enter your details to sign in.</p>
        </header>
        {signInMethods.length === 0 && socialConnectors.length > 0 ? (
          <SocialSignInList className={styles.main} socialConnectors={socialConnectors} />
        ) : isPasswordOnly ? (
          <PasswordSignInForm
            className={styles.main}
            signInMethods={signInMethods.map(({ identifier }) => identifier)}
          />
        ) : signInMethods.length > 0 ? (
          <IdentifierSignInForm className={styles.main} signInMethods={signInMethods} />
        ) : null}
        {agreeToTermsPolicy === AgreeToTermsPolicy.Manual && (
          <TermsAndPrivacyCheckbox className={styles.checkbox} />
        )}
      </>
    );
  }

  if (signInMethods.length === 0 && socialConnectors.length > 0) {
    return (
      <>
        <SocialSignInList className={styles.main} socialConnectors={socialConnectors} />
        {
          /**
           * Display agreement checkbox when only social sign-in methods are available
           * and the user needs to agree to terms manually.
           */
          agreeToTermsPolicy === AgreeToTermsPolicy.Manual && (
            <TermsAndPrivacyCheckbox className={styles.checkbox} />
          )
        }
      </>
    );
  }

  if (isPasswordOnly) {
    return (
      <PasswordSignInForm
        className={styles.main}
        signInMethods={signInMethods.map(({ identifier }) => identifier)}
      />
    );
  }

  if (signInMethods.length > 0) {
    return <IdentifierSignInForm className={styles.main} signInMethods={signInMethods} />;
  }

  return null;
};

export default Main;
