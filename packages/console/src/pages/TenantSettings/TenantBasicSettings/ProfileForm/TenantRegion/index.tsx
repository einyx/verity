import { useContext } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { getRegionDisplayName, StaticRegion } from '@/components/Region';
import { logtoCloudTenantSettings } from '@/consts';
import { TenantsContext } from '@/contexts/TenantsProvider';
import TextLink from '@/ds-components/TextLink';
import useDocumentationUrl from '@/hooks/use-documentation-url';

import styles from './index.module.scss';

function TenantRegion() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { getDocumentationUrl } = useDocumentationUrl();
  const { currentTenant } = useContext(TenantsContext);
  const regionName = currentTenant?.regionName;

  if (!regionName) {
    return null;
  }

  return (
    <div className={styles.container}>
      <StaticRegion className={styles.region} regionName={regionName} />
      <div className={styles.regionTip}>
        <Trans
          components={{
            a: (
              <TextLink
                targetBlank="noopener"
                href={getDocumentationUrl(logtoCloudTenantSettings)}
              />
            ),
          }}
        >
          {t('tenants.settings.tenant_region_tip', { region: getRegionDisplayName(regionName) })}
        </Trans>
      </div>
    </div>
  );
}

export default TenantRegion;
