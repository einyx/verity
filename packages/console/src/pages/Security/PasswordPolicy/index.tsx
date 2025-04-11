import { FormCardSkeleton } from '@/components/FormCard';
import PageMeta from '@/components/PageMeta';
import RequestDataError from '@/components/RequestDataError';

import PasswordPolicyForm from './PasswordPolicyForm';
import styles from './index.module.scss';
import usePasswordPolicy from './use-password-policy';

function PasswordPolicy() {
  const { isLoading, data, error, mutate } = usePasswordPolicy();

  return (
    <div className={styles.content}>
      <PageMeta titleKey={['security.tabs.password_policy', 'security.page_title']} />
      {isLoading ? <FormCardSkeleton formFieldCount={2} /> : null}
      {error && <RequestDataError error={error} onRetry={mutate} />}
      {data && <PasswordPolicyForm data={data} />}
    </div>
  );
}

export default PasswordPolicy;
