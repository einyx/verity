import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import Plus from '@/assets/icons/plus.svg?react';
import DetailsPage from '@/components/DetailsPage';
import DetailsPageHeader from '@/components/DetailsPage/DetailsPageHeader';
import PageMeta from '@/components/PageMeta';
import RequestDataError from '@/components/RequestDataError';
import Button from '@/ds-components/Button';
import CardTitle from '@/ds-components/CardTitle';
import DangerousRaw from '@/ds-components/DangerousRaw';
import Table from '@/ds-components/Table';
import useApi from '@/hooks/use-api';
import { type RequestError } from '@/hooks/use-api';
import pageLayout from '@/scss/page-layout.module.scss';

import PortalAccess from './PortalAccess';
import PortalConnect, { SetupBanner } from './PortalConnect';
import { AddServerModal } from './PortalForms';
import ServerAccess from './ServerAccess';
import ServerCredential from './ServerCredential';
import ServerIcon from './ServerIcon';
import UpstreamTools from './UpstreamTools';
import styles from './index.module.scss';
import { type Portal, type Upstream, type UpstreamsResponse, listKeyFor } from './types';

// One portal's servers. Adding, switching and removing servers apply to this portal only.
function PortalServers({
  portal,
  backLink,
}: {
  readonly portal: Portal;
  readonly backLink: string;
}) {
  const api = useApi();
  const listKey = listKeyFor(portal.id);
  const { data, error, isLoading, mutate } = useSWR<UpstreamsResponse, RequestError>(listKey);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formError, setFormError] = useState<string>();
  // Shown after a just-added server does not answer. Cleared on reload, since the list does not track it.
  const [notice, setNotice] = useState<string>();
  const [unreachable, setUnreachable] = useState<string[]>([]);
  // Tools and settings open independently, so the sign-in controls are never hidden behind the tool list.
  const [openTools, setOpenTools] = useState<string>();
  const [openSettings, setOpenSettings] = useState<string>();
  const detailsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openTools ?? openSettings) {
      detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [openTools, openSettings]);

  if (error) {
    return <RequestDataError error={error} />;
  }

  const upstreams = data?.upstreams ?? [];
  const openToolsUpstream = upstreams.find((upstream) => upstream.name === openTools);
  const openSettingsUpstream = upstreams.find((upstream) => upstream.name === openSettings);

  const setUpstreamEnabled = async (upstream: Upstream, enabled: boolean) => {
    setFormError(undefined);

    try {
      await api.patch(`${listKey}/${encodeURIComponent(upstream.name)}`, { json: { enabled } });
      await mutate();
    } catch {
      setFormError(`Could not turn "${upstream.name}" ${enabled ? 'on' : 'off'}. Try again.`);
    }
  };

  const removeUpstream = async (upstream: Upstream) => {
    setFormError(undefined);

    try {
      await api.delete(`${listKey}/${encodeURIComponent(upstream.name)}`);
      await mutate();
      if (openTools === upstream.name) {
        setOpenTools(undefined);
      }
      if (openSettings === upstream.name) {
        setOpenSettings(undefined);
      }
    } catch {
      setFormError(`Could not remove "${upstream.name}". Try again.`);
    }
  };

  return (
    <DetailsPage backLink={backLink} backLinkTitle={<DangerousRaw>Back to portals</DangerousRaw>}>
      <PageMeta titleKey="mcp_portal.page_title" />
      <DetailsPageHeader
        title={portal.name}
        primaryTag={portal.hostname}
        identifier={{ name: 'ID', value: portal.id }}
        subtitle={`${upstreams.filter((item) => item.enabled !== false).length} of ${upstreams.length} servers on`}
      />
      <div className={styles.container}>
        <SetupBanner portal={portal} />
        <PortalConnect portal={portal} />

        <PortalAccess portal={portal} />

        <div className={styles.serversSection}>
          <div className={pageLayout.headline}>
            <CardTitle
              title={<DangerousRaw>MCP servers</DangerousRaw>}
              subtitle={
                <DangerousRaw>
                  The servers this portal offers to its users. Switch one off, choose its tools, or
                  give it a credential.
                </DangerousRaw>
              }
            />
            <Button
              icon={<Plus />}
              type="primary"
              size="large"
              title={<DangerousRaw>Add server</DangerousRaw>}
              onClick={() => {
                setIsAddOpen(true);
              }}
            />
          </div>

          {formError && (
            <p role="alert" className={styles.error}>
              {formError}
            </p>
          )}
          {notice && (
            <p role="status" className={styles.warning}>
              {notice}
            </p>
          )}

          <Table
            className={pageLayout.table}
            rowGroups={[{ key: 'servers', data: upstreams }]}
            rowIndexKey="name"
            isLoading={isLoading}
            columns={[
              {
                title: 'Server',
                dataIndex: 'name',
                colSpan: 8,
                render: (upstream) => (
                  <div className={styles.serverCell}>
                    <ServerIcon name={upstream.name} />
                    <div className={styles.serverText}>
                      <div className={styles.serverName}>{upstream.name}</div>
                      <div className={styles.muted}>{upstream.url}</div>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Status',
                dataIndex: 'enabled',
                colSpan: 4,
                render: (upstream) => {
                  const enabled = upstream.enabled !== false;
                  const isUnreachable = enabled && unreachable.includes(upstream.name);
                  const label = enabled ? (isUnreachable ? 'Unreachable' : 'On') : 'Off';

                  return (
                    <span className={styles.status} data-on={enabled} data-warning={isUnreachable}>
                      <span className={styles.statusDot} aria-hidden="true" />
                      {label}
                    </span>
                  );
                },
              },
              {
                title: 'Enabled',
                dataIndex: 'enabled',
                colSpan: 3,
                render: (upstream) => {
                  const enabled = upstream.enabled !== false;

                  return (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${upstream.name} enabled`}
                      className={styles.toggle}
                      data-on={enabled}
                      onClick={() => {
                        void setUpstreamEnabled(upstream, !enabled);
                      }}
                    >
                      <span />
                    </button>
                  );
                },
              },
              {
                title: 'Actions',
                dataIndex: 'name',
                colSpan: 9,
                render: (upstream) => (
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-expanded={openTools === upstream.name}
                      onClick={() => {
                        setOpenTools((current) =>
                          current === upstream.name ? undefined : upstream.name
                        );
                      }}
                    >
                      {openTools === upstream.name ? 'Hide tools' : 'Tools'}
                    </button>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-expanded={openSettings === upstream.name}
                      onClick={() => {
                        setOpenSettings((current) =>
                          current === upstream.name ? undefined : upstream.name
                        );
                      }}
                    >
                      {openSettings === upstream.name ? 'Hide settings' : 'Settings'}
                    </button>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => {
                        void removeUpstream(upstream);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ),
              },
            ]}
            placeholder={
              <div className={styles.muted}>No MCP servers yet. Add one with the button above.</div>
            }
            onRetry={async () => mutate(undefined, true)}
          />

          {/* The panels open below the list, so scroll them into view or they stay off screen. */}
          <div ref={detailsRef}>
            {openToolsUpstream && (
              <section className={styles.serverBody} aria-label={`${openToolsUpstream.name} tools`}>
                <h3 className={styles.sectionTitle}>Tools</h3>
                <UpstreamTools listKey={listKey} upstream={openToolsUpstream} onChanged={mutate} />
              </section>
            )}

            {openSettingsUpstream && (
              <section
                className={styles.serverBody}
                aria-label={`${openSettingsUpstream.name} settings`}
              >
                <h3 className={styles.sectionTitle}>Who can use it</h3>
                <ServerAccess listKey={listKey} upstream={openSettingsUpstream} onSaved={mutate} />
                <h3 className={styles.sectionTitle}>Sign-in</h3>
                <ServerCredential
                  listKey={listKey}
                  upstream={openSettingsUpstream}
                  onSaved={mutate}
                />
              </section>
            )}
          </div>
        </div>
      </div>

      {isAddOpen && (
        <AddServerModal
          listKey={listKey}
          onClose={() => {
            setIsAddOpen(false);
          }}
          onAdded={async ({ name, reachable }) => {
            await mutate();

            if (!reachable) {
              setNotice(
                `Saved "${name}", but it did not answer. It shows as unreachable until its URL responds.`
              );
              setUnreachable((current) => [...current, name]);
            }
          }}
        />
      )}
    </DetailsPage>
  );
}

export default PortalServers;
