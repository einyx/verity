/* eslint-disable @silverhand/fp/no-mutating-methods, id-length, react/boolean-prop-naming, react/no-array-index-key, no-restricted-syntax, complexity, no-alert, max-params, max-lines, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- The existing Kubo stack editor predates these lint limits; keep this deletion change scoped until the editor is split up. */
import { type AdminConsoleKey } from '@logto/phrases';
import { useId, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import RequestDataError from '@/components/RequestDataError';
import Button from '@/ds-components/Button';
import Card from '@/ds-components/Card';
import CardTitle from '@/ds-components/CardTitle';
import Checkbox from '@/ds-components/Checkbox';
import DangerousRaw from '@/ds-components/DangerousRaw';
import DeleteConfirmModal from '@/ds-components/DeleteConfirmModal';
import Select from '@/ds-components/Select';
import Table from '@/ds-components/Table';
import Tag from '@/ds-components/Tag';
import TextInput from '@/ds-components/TextInput';
import useApi, { type RequestError } from '@/hooks/use-api';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import styles from './index.module.scss';

type KuboCondition = { type: string; status: string; reason?: string; message?: string };

type KuboComponent = {
  name: string;
  phase: string;
  revision?: number;
  message?: string;
  dependsOn?: string[];
};

type KuboStackDetail = {
  namespace: string;
  name: string;
  mode: string;
  phase: string;
  ready: number;
  total: number;
  failing?: string[] | undefined;
  paused?: boolean;
  computeMonthlyUsd?: number;
  requestedCpuMilli?: number;
  requestedMemoryBytes?: number;
  bundle?: string;
  gitManaged?: boolean;
  url?: string;
  componentValues?: Record<string, { config?: Record<string, unknown> }>;
  exclude?: string[] | undefined;
  operators?: Record<string, boolean> | undefined;
  featureFlags?: Record<string, string> | undefined;
  imageTags?: Record<string, string> | undefined;
  chartVersions?: Record<string, string> | undefined;
  conditions?: KuboCondition[] | undefined;
  components?: KuboComponent[] | undefined;
};

type KeyValueRow = { key: string; value: string };

const modes = ['Direct', 'Flux'];

const formatUsd = (value?: number) => (value === undefined ? '—' : `$${value.toFixed(2)}/mo`);
const formatGiB = (bytes?: number) =>
  bytes === undefined ? '—' : `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

const toRows = (values?: Record<string, string> | undefined): KeyValueRow[] =>
  Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));

const toMap = (rows: KeyValueRow[]) =>
  Object.fromEntries(
    rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value])
  );

const safeWebURL = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    // Ignore malformed environment URLs.
    return undefined;
  }
};

const environmentLinks = (data: KuboStackDetail) => {
  const configured = [
    { label: 'Builder', value: data.componentValues?.['v1-api']?.config?.V1_PUBLIC_URL },
    { label: 'Renderer', value: data.componentValues?.['v1-apps']?.config?.V1_APPS_URL },
  ].flatMap(({ label, value }) => {
    const url = safeWebURL(value);
    return url ? [{ label, url }] : [];
  });
  if (configured.length > 0) {
    return configured;
  }
  const url = safeWebURL(data.url);
  return url ? [{ label: 'Environment', url }] : [];
};

// Grouped setting rows still save only their own field.
function Section({
  title,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  error,
  view,
  editor,
}: {
  readonly title: AdminConsoleKey;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly error?: string;
  readonly view: React.ReactNode;
  readonly editor: React.ReactNode;
}) {
  const id = useId();
  return (
    <section className={styles.setting} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHeader}>
        <div id={`${id}-title`}>
          <CardTitle title={title} size="small" />
        </div>
        {!editing && (
          <Button
            id={`${id}-edit`}
            aria-labelledby={`${id}-edit ${id}-title`}
            title="general.edit"
            type="outline"
            size="small"
            onClick={onEdit}
          />
        )}
      </div>
      <div className={styles.settingBody}>{editing ? editor : view}</div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {editing && (
        <div className={styles.actions}>
          <Button title="general.cancel" type="outline" onClick={onCancel} />
          <Button title="general.save" type="primary" isLoading={saving} onClick={onSave} />
        </div>
      )}
    </section>
  );
}

// Editable name → value rows. The portal replaces the whole map on save.
function KeyValueEditor({
  rows,
  onChange,
}: {
  readonly rows: KeyValueRow[];
  readonly onChange: (rows: KeyValueRow[]) => void;
}) {
  return (
    <div className={styles.kvEditor}>
      {rows.map((row, index) => (
        <div key={index} className={styles.kvRow}>
          <TextInput
            value={row.key}
            placeholder="Name"
            onChange={(event) => {
              onChange(
                rows.map((r, i) =>
                  i === index ? { ...r, key: (event.target as HTMLInputElement).value } : r
                )
              );
            }}
          />
          <TextInput
            value={row.value}
            placeholder="Value"
            onChange={(event) => {
              onChange(
                rows.map((r, i) =>
                  i === index ? { ...r, value: (event.target as HTMLInputElement).value } : r
                )
              );
            }}
          />
          <Button
            title="general.delete"
            type="text"
            size="small"
            onClick={() => {
              onChange(rows.filter((_, i) => i !== index));
            }}
          />
        </div>
      ))}
      <Button
        title="general.add"
        type="text"
        size="small"
        onClick={() => {
          onChange([...rows, { key: '', value: '' }]);
        }}
      />
    </div>
  );
}

function KeyValueTable({ rows }: { readonly rows: KeyValueRow[] }) {
  if (rows.length === 0) {
    return <p className={styles.muted}>None set</p>;
  }
  return (
    <Table
      rowGroups={[{ key: 'values', data: rows }]}
      rowIndexKey="key"
      columns={[
        { title: 'Name', dataIndex: 'key', render: (row: KeyValueRow) => row.key },
        { title: 'Value', dataIndex: 'value', render: (row: KeyValueRow) => row.value || '—' },
      ]}
      placeholder="None set"
    />
  );
}

function TableViewport({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Named overflow regions need keyboard focus so arrow keys can scroll the table.
    <div className={styles.tableViewport} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

function Stack() {
  const { namespace = '', name = '' } = useParams();
  // Tenant-aware navigate, so the redirect stays under /<tenant>/console instead of the marketing root.
  const { navigate } = useTenantPathname();
  const api = useApi();
  const { data, error, isLoading, mutate } = useSWR<KuboStackDetail, RequestError>(
    namespace && name ? `api/kubo/stacks/${namespace}/${name}` : null
  );
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapJob, setBootstrapJob] = useState<string>();
  const [bootstrapError, setBootstrapError] = useState<string>();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [purgeNamespace, setPurgeNamespace] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const patch = async (body: Record<string, unknown>) => {
    await api.patch(`api/kubo/stacks/${namespace}/${name}`, { json: body }).json();
    await mutate();
  };

  // Per-section edit state, kept in one place so the cards stay independent.
  const [editing, setEditing] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [sectionError, setSectionError] = useState<Record<string, string | undefined>>({});
  const [draft, setDraft] = useState<unknown>();

  const start = (field: string, initial: unknown) => {
    setEditing(field);
    setDraft(initial);
    setSectionError((previous) => ({ ...previous, [field]: undefined }));
  };

  const cancel = () => {
    setEditing(undefined);
  };

  const commit = async (field: string, value: unknown) => {
    setSaving(true);
    setSectionError((previous) => ({ ...previous, [field]: undefined }));
    try {
      await patch({ [field]: value });
      setEditing(undefined);
    } catch (error_: unknown) {
      setSectionError((previous) => ({
        ...previous,
        [field]: error_ instanceof Error ? error_.message : 'Save failed',
      }));
    } finally {
      setSaving(false);
    }
  };

  const runBootstrap = async () => {
    // Bootstrap re-runs the workspace's initial setup jobs, so confirm before starting it.
    if (!window.confirm(`Run bootstrap for ${name}?`)) {
      return;
    }
    setBootstrapping(true);
    setBootstrapError(undefined);
    try {
      const result = await api
        .post(`api/kubo/stacks/${namespace}/${name}/bootstrap`)
        .json<{ job: string }>();
      setBootstrapJob(result.job);
    } catch (error_: unknown) {
      setBootstrapError(error_ instanceof Error ? error_.message : 'Bootstrap failed');
    } finally {
      setBootstrapping(false);
    }
  };

  const closeDelete = () => {
    setIsDeleteOpen(false);
    setPurgeNamespace(false);
    setDeleteError(undefined);
  };

  const deleteStack = async () => {
    if (
      purgeNamespace &&
      !window.confirm(
        `Deleting namespace "${namespace}" removes everything in it, not just this stack. Continue?`
      )
    ) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(undefined);
    try {
      await api.delete(`api/kubo/stacks/${namespace}/${name}?purge=${String(purgeNamespace)}`);
      navigate('/infrastructure', { replace: true });
    } catch (error_: unknown) {
      setDeleteError(error_ instanceof Error ? error_.message : 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  };

  if (error) {
    return <RequestDataError error={error} />;
  }

  const isEditing = (field: string) => editing === field;
  const sectionProps = (
    field: string,
    title: AdminConsoleKey,
    view: React.ReactNode,
    editor: React.ReactNode,
    initial: unknown,
    value: () => unknown
  ) => ({
    title,
    editing: isEditing(field),
    onEdit: () => {
      start(field, initial);
    },
    onCancel: cancel,
    onSave: () => {
      void commit(field, value());
    },
    saving,
    error: sectionError[field],
    view,
    editor,
  });
  const links = data ? environmentLinks(data) : [];
  const pendingComponents = (data?.components ?? []).filter(
    (component) =>
      component.phase.toLowerCase() !== 'ready' || (data?.failing ?? []).includes(component.name)
  );
  const isReady =
    data &&
    data.total > 0 &&
    data.ready === data.total &&
    !data.failing?.length &&
    pendingComponents.length === 0;

  return (
    <div className={styles.container}>
      <Helmet title={`MeshX · ${name}`} />
      <div className={styles.header}>
        <div className={styles.eyebrow}>Infrastructure / Workspaces / {namespace}</div>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{name}</h2>
          {data && (
            <Button
              title="tabs.run_bootstrap"
              type="primary"
              isLoading={bootstrapping}
              onClick={runBootstrap}
            />
          )}
        </div>
        {data && (
          <p className={styles.description}>
            {data.phase} · {data.mode}
            {data.paused ? ' · paused' : ''}
            {data.gitManaged ? ' · Git managed' : ''}
          </p>
        )}
        {links.length > 0 && (
          <div className={styles.environmentLinks}>
            {links.map(({ label, url }) => (
              <a
                key={label}
                className={styles.environmentLink}
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                <span>{label}</span>
                <span className={styles.environmentURL}>{url}</span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {isLoading && <p className={styles.muted}>Loading…</p>}

      {data && (
        <>
          <div className={styles.summary}>
            <Card className={styles.summaryItem}>
              <div className={styles.summaryValue}>
                {data.ready}/{data.total}
              </div>
              <div className={styles.summaryLabel}>Components ready</div>
            </Card>
            <Card className={styles.summaryItem}>
              <div className={styles.summaryValue}>{formatUsd(data.computeMonthlyUsd)}</div>
              <div className={styles.summaryLabel}>Estimated compute</div>
            </Card>
            <Card className={styles.summaryItem}>
              <div className={styles.summaryValue}>
                {data.requestedCpuMilli === undefined
                  ? '—'
                  : `${(data.requestedCpuMilli / 1000).toFixed(1)} vCPU`}
              </div>
              <div className={styles.summaryLabel}>Requested CPU</div>
            </Card>
            <Card className={styles.summaryItem}>
              <div className={styles.summaryValue}>{formatGiB(data.requestedMemoryBytes)}</div>
              <div className={styles.summaryLabel}>Requested memory</div>
            </Card>
          </div>

          {bootstrapJob && <p className={styles.muted}>Bootstrap job started: {bootstrapJob}</p>}
          {bootstrapError && (
            <p role="alert" className={styles.error}>
              {bootstrapError}
            </p>
          )}

          {isDeleteOpen && (
            <DeleteConfirmModal
              isOpen
              isLoading={isDeleting}
              expectedInput={namespace}
              inputPlaceholder={namespace}
              onCancel={closeDelete}
              onConfirm={() => {
                void deleteStack();
              }}
            >
              <p>
                Deleting this stack uninstalls its releases. Type <strong>{namespace}</strong> to
                confirm.
              </p>
              <Checkbox
                label="Also delete the namespace (removes everything in it)"
                checked={purgeNamespace}
                onChange={setPurgeNamespace}
              />
              {deleteError && <p className={styles.error}>{deleteError}</p>}
            </DeleteConfirmModal>
          )}

          <section className={styles.health} aria-label="Stack health">
            <div className={styles.healthHeading}>
              <h3>Stack health</h3>
              <Tag status={data.failing?.length ? 'error' : isReady ? 'success' : 'alert'}>
                {data.phase}
              </Tag>
            </div>
            <p className={styles.muted}>
              {isReady
                ? 'All components are ready.'
                : `${data.ready} of ${data.total} components ready. ${
                    data.failing?.length ? 'Some components need attention.' : ''
                  }`}
            </p>
            {pendingComponents.length > 0 ? (
              <ul className={styles.healthList}>
                {pendingComponents.map((component) => (
                  <li key={component.name}>
                    <strong>{component.name}</strong>
                    <span className={styles.componentPhase}>{component.phase}</span>
                    {component.message && <p>{component.message}</p>}
                  </li>
                ))}
              </ul>
            ) : isReady ? null : (
              <p className={styles.muted}>Component status is not available yet.</p>
            )}
          </section>

          <section aria-label="Components" className={styles.components}>
            <Card className={styles.section}>
              <CardTitle title="infrastructure.components" size="medium" />
              <TableViewport label="Component details">
                <Table
                  rowGroups={[{ key: 'components', data: data.components ?? [] }]}
                  rowIndexKey="name"
                  columns={[
                    {
                      title: 'Component',
                      dataIndex: 'name',
                      render: (row: KuboComponent) => row.name,
                    },
                    {
                      title: 'Phase',
                      dataIndex: 'phase',
                      render: (row: KuboComponent) =>
                        (data.failing ?? []).includes(row.name) ? (
                          <Tag status="error">{row.phase}</Tag>
                        ) : (
                          row.phase
                        ),
                    },
                    {
                      title: 'Revision',
                      dataIndex: 'revision',
                      render: (row: KuboComponent) => row.revision ?? '—',
                    },
                    {
                      title: 'Depends on',
                      dataIndex: 'dependsOn',
                      render: (row: KuboComponent) => (row.dependsOn ?? []).join(', ') || '—',
                    },
                    {
                      title: 'Message',
                      dataIndex: 'message',
                      render: (row: KuboComponent) => row.message ?? '—',
                    },
                  ]}
                />
              </TableViewport>
            </Card>
          </section>

          {(data.conditions?.length ?? 0) > 0 && (
            <details className={styles.configurationGroup}>
              <summary>Controller conditions</summary>
              <TableViewport label="Controller condition details">
                <Table
                  rowGroups={[{ key: 'conditions', data: data.conditions ?? [] }]}
                  rowIndexKey="type"
                  columns={[
                    { title: 'Type', dataIndex: 'type', render: (row: KuboCondition) => row.type },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      render: (row: KuboCondition) => row.status,
                    },
                    {
                      title: 'Reason',
                      dataIndex: 'reason',
                      render: (row: KuboCondition) => row.reason ?? '—',
                    },
                    {
                      title: 'Message',
                      dataIndex: 'message',
                      render: (row: KuboCondition) => row.message ?? '—',
                    },
                  ]}
                />
              </TableViewport>
            </details>
          )}

          <details className={styles.configurationGroup}>
            <summary>Deployment settings</summary>
            <Section
              {...sectionProps(
                'bundle',
                'infrastructure.bundle',
                <p>{data.bundle || 'Not set'}</p>,
                <TextInput
                  value={(draft as string) ?? ''}
                  placeholder="oci://… (empty clears the bundle)"
                  onChange={(event) => {
                    setDraft((event.target as HTMLInputElement).value.trim());
                  }}
                />,
                data.bundle ?? '',
                () => (draft as string) || ''
              )}
            />

            <Section
              {...sectionProps(
                'mode',
                'infrastructure.mode',
                <p>{data.mode}</p>,
                <Select
                  value={(draft as string) ?? data.mode}
                  options={modes.map((mode) => ({ value: mode, title: mode }))}
                  onChange={(value) => {
                    setDraft(value);
                  }}
                />,
                data.mode,
                () => (draft as string) ?? data.mode
              )}
            />

            <Section
              {...sectionProps(
                'exclude',
                'infrastructure.excluded_components',
                <p>{(data.exclude ?? []).join(', ') || 'None'}</p>,
                <TextInput
                  value={(draft as string) ?? ''}
                  placeholder="comma, separated, names"
                  onChange={(event) => {
                    setDraft((event.target as HTMLInputElement).value);
                  }}
                />,
                (data.exclude ?? []).join(', '),
                () =>
                  ((draft as string) ?? '')
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
              )}
            />

            <Section
              {...sectionProps(
                'operators',
                'infrastructure.operators',
                <ul className={styles.operatorList}>
                  {Object.entries(data.operators ?? {}).map(([key, on]) => (
                    <li key={key}>
                      <span>{key}</span>
                      <span className={styles.muted}>{on ? 'Enabled' : 'Disabled'}</span>
                    </li>
                  ))}
                  {Object.keys(data.operators ?? {}).length === 0 && (
                    <li className={styles.muted}>None</li>
                  )}
                </ul>,
                <div className={styles.checkList}>
                  {Object.entries((draft as Record<string, boolean>) ?? {}).map(([key, on]) => (
                    <Checkbox
                      key={key}
                      label={key}
                      checked={on}
                      onChange={(checked) => {
                        setDraft({ ...(draft as Record<string, boolean>), [key]: checked });
                      }}
                    />
                  ))}
                </div>,
                { ...data.operators },
                () => (draft as Record<string, boolean>) ?? {}
              )}
            />
          </details>
          <details className={styles.configurationGroup}>
            <summary>Version and feature overrides</summary>
            <Section
              {...sectionProps(
                'featureFlags',
                'infrastructure.feature_flags',
                <KeyValueTable rows={toRows(data.featureFlags)} />,
                <KeyValueEditor
                  rows={(draft as KeyValueRow[]) ?? []}
                  onChange={(rows) => {
                    setDraft(rows);
                  }}
                />,
                toRows(data.featureFlags),
                () => toMap((draft as KeyValueRow[]) ?? [])
              )}
            />

            <Section
              {...sectionProps(
                'imageTags',
                'infrastructure.image_tags',
                <KeyValueTable rows={toRows(data.imageTags)} />,
                <KeyValueEditor
                  rows={(draft as KeyValueRow[]) ?? []}
                  onChange={(rows) => {
                    setDraft(rows);
                  }}
                />,
                toRows(data.imageTags),
                () => toMap((draft as KeyValueRow[]) ?? [])
              )}
            />

            <Section
              {...sectionProps(
                'chartVersions',
                'infrastructure.helm_chart_versions',
                <KeyValueTable rows={toRows(data.chartVersions)} />,
                <KeyValueEditor
                  rows={(draft as KeyValueRow[]) ?? []}
                  onChange={(rows) => {
                    setDraft(rows);
                  }}
                />,
                toRows(data.chartVersions),
                () => toMap((draft as KeyValueRow[]) ?? [])
              )}
            />
          </details>

          <section className={styles.dangerZone} aria-label="Danger zone">
            <div>
              <h3>Delete stack</h3>
              <p className={styles.muted}>
                Uninstall this stack’s releases. This action requires confirmation.
              </p>
            </div>
            <Button
              title={<DangerousRaw>Delete stack</DangerousRaw>}
              type="outlineDanger"
              onClick={() => {
                setIsDeleteOpen(true);
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}

export default Stack;
/* eslint-enable @silverhand/fp/no-mutating-methods, id-length, react/boolean-prop-naming, react/no-array-index-key, no-restricted-syntax, complexity, no-alert, max-params, max-lines, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition */
