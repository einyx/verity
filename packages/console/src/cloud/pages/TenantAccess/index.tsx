import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import useSWR from 'swr';

import { cloudApi } from '@/consts';
import Button from '@/ds-components/Button';
import CardTitle from '@/ds-components/CardTitle';
import DangerousRaw from '@/ds-components/DangerousRaw';
import TextInput from '@/ds-components/TextInput';
import { useStaticApi } from '@/hooks/use-api';
import pageLayout from '@/scss/page-layout.module.scss';

import styles from './index.module.scss';

// Who may manage customer tenants: admins of this admin tenant, and anyone whose email is on this list.
// Only operators of the admin tenant can change it, and everyone else gets no sign that it exists.

type TenantAccessPolicy = { domains: string[] };

const domainPattern = /^[\da-z-]+(\.[\da-z-]+)+$/;

function TenantAccess() {
  const api = useStaticApi({
    prefixUrl: new URL(window.location.origin),
    resourceIndicator: cloudApi.indicator,
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { data, error, mutate } = useSWR<TenantAccessPolicy>('api/tenant-access-policy', async () =>
    api.get('api/tenant-access-policy').json<TenantAccessPolicy>()
  );
  const [domains, setDomains] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (data) {
      setDomains(data.domains);
    }
  }, [data]);

  const add = () => {
    const domain = draft.trim().toLowerCase();

    if (!domainPattern.test(domain)) {
      setInvalid(true);

      return;
    }

    setInvalid(false);

    if (!domains.includes(domain)) {
      setDomains([...domains, domain]);
    }
    setDraft('');
  };

  const save = async () => {
    setSaving(true);
    setSaveFailed(false);

    try {
      const saved = await api
        .put('api/tenant-access-policy', { json: { domains } })
        .json<TenantAccessPolicy>();
      await mutate(saved, false);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const unchanged = data?.domains.join(',') === domains.join(',');

  return (
    <div className={pageLayout.container}>
      <Helmet>
        <title>Tenant access</title>
      </Helmet>
      <div className={pageLayout.headline}>
        <CardTitle
          title={<DangerousRaw>Tenant access</DangerousRaw>}
          subtitle={
            <DangerousRaw>
              Users whose email is on this list can create and manage customer tenants. Anyone else
              is refused. Enter a domain such as meshx.io, without the @.
            </DangerousRaw>
          }
        />
      </div>
      <div className={styles.page}>
        {error ? (
          <p className={styles.error}>
            Only operators of this admin tenant can change tenant access.
          </p>
        ) : (
          <>
            <ul className={styles.list}>
              {domains.map((domain) => (
                <li key={domain} className={styles.item}>
                  <span>{domain}</span>
                  <Button
                    type="default"
                    title={<DangerousRaw>Remove</DangerousRaw>}
                    onClick={() => {
                      setDomains(domains.filter((item) => item !== domain));
                    }}
                  />
                </li>
              ))}
            </ul>

            <div className={styles.row}>
              <TextInput
                value={draft}
                placeholder="example.com"
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              />
              <Button
                type="default"
                title={<DangerousRaw>Add domain</DangerousRaw>}
                onClick={add}
              />
            </div>

            {invalid && <p className={styles.error}>Enter a domain such as meshx.io.</p>}

            <div className={styles.row}>
              <Button
                type="primary"
                title={<DangerousRaw>Save</DangerousRaw>}
                disabled={saving || unchanged || domains.length === 0}
                onClick={save}
              />
              {saveFailed && (
                <p className={styles.error}>The list could not be saved. Try again.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TenantAccess;
