import { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import BarGraphIcon from '@/assets/icons/bar-graph.svg?react';
import ConnectionIcon from '@/assets/icons/connection.svg?react';
import CubeIcon from '@/assets/icons/cube.svg?react';
import DocumentIcon from '@/assets/icons/document.svg?react';
import FormCardLayout from '@/components/FormCard/FormCardLayout';
import Button from '@/ds-components/Button';
import Select from '@/ds-components/Select';
import useApi, { type RequestError } from '@/hooks/use-api';

import styles from '../index.module.scss';

import ChoiceItem from './ChoiceItem';
import { StepIntro } from './StepIntro';
import { readError } from './errors';
import { type StackOption, stackOptions, toStep } from './options';

// Lowercase RFC-1123 label, as the portal requires for a tenant ID.
const tenantPattern = /^[\da-z]([\da-z-]{0,61}[\da-z])?$/;

// The template preview endpoint for the review step, or null until a template and tenant are set.
function previewUrl(
  template: string | undefined,
  tenant: string,
  provider: 'logto' | 'auth0',
  mode: string
): string | undefined {
  if (!template || !tenant) {
    return undefined;
  }
  const query = new URLSearchParams({
    template,
    tenant,
    authProvider: provider,
    ...(mode ? { mode } : {}),
  });
  return `api/kubo/template?${query.toString()}`;
}

function KuboWizard() {
  const api = useApi();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<StackOption>();
  const [tenant, setTenant] = useState('');
  const [mode, setMode] = useState('');
  const [provider, setProvider] = useState<'logto' | 'auth0'>('logto');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  const previewKey =
    step === 3 ? previewUrl(selected?.template, tenant, provider, mode) : undefined;
  const preview = useSWR<{ yaml: string }, RequestError>(previewKey);
  // Workspace totals for the header stats; the list is the same one the Workspaces page reads.
  const workspaces = useSWR<Array<{ phase: string }>, RequestError>('api/kubo/stacks');
  const workspaceTotal = workspaces.data?.length;
  const workspaceReady = workspaces.data?.filter((stack) => stack.phase === 'Ready').length;

  const create = async () => {
    if (!selected?.template) {
      return;
    }
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await api
        .post('api/kubo/stacks', {
          json: {
            template: selected.template,
            tenant,
            authProvider: provider,
            ...(mode ? { mode } : {}),
            ...(selected.exclude.length > 0 ? { exclude: selected.exclude } : {}),
          },
        })
        .json();
      navigate('/infrastructure');
    } catch (error: unknown) {
      setSubmitError(await readError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const tenantValid = tenantPattern.test(tenant);
  const canContinue = step === 1 ? Boolean(selected?.available) : tenantValid;

  const introduction = (
    <StepIntro
      step={step}
      onStepChange={(number) => {
        setStep(toStep(number));
      }}
    />
  );
  return (
    <>
      <Helmet title="MeshX · New workspace" />
      <div className={styles.wizardHeader}>
        <div className={styles.title}>New workspace</div>
        <a className={styles.headerLink} href="/">
          Back to landing
        </a>
      </div>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Workspaces</div>
          <div className={styles.statValue}>{workspaceTotal ?? '–'}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Ready</div>
          <div className={styles.statValue}>{workspaceReady ?? '–'}</div>
        </div>
      </div>
      <FormCardLayout introduction={introduction}>
        {step === 1 && (
          <>
            <div className={styles.progress} aria-label="Step 1 of 3">
              <span className={styles.progressOn} />
              <span />
              <span />
            </div>
            <div className={styles.sectionTitle}>Templates</div>
            <ul className={styles.templateGrid}>
              {stackOptions.map((option) => (
                <li key={option.id}>
                  <ChoiceItem
                    option={option}
                    selected={selected}
                    onSelect={() => {
                      setSelected(option);
                    }}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 2 && (
          <div className={styles.form}>
            <label className={styles.field}>
              Tenant ID
              <input
                value={tenant}
                placeholder="acme"
                onChange={(event) => {
                  setTenant(event.target.value.trim().toLowerCase());
                }}
              />
              {tenant && !tenantValid && (
                <span className={styles.error}>
                  Use lowercase letters, digits and hyphens. Start and end with a letter or digit.
                </span>
              )}
            </label>
            <div className={styles.field}>
              Identity provider
              <Select
                value={provider}
                options={[
                  { value: 'logto', title: 'Logto (recommended)' },
                  { value: 'auth0', title: 'Auth0' },
                ]}
                onChange={(value) => {
                  if (value) {
                    setProvider(value);
                  }
                }}
              />
            </div>
            <label className={styles.field}>
              Mode (optional)
              <input
                value={mode}
                placeholder="Direct"
                onChange={(event) => {
                  setMode(event.target.value.trim());
                }}
              />
            </label>
          </div>
        )}

        {step === 3 && (
          <>
            <dl className={styles.budget}>
              <dt>Type</dt>
              <dd>{selected?.title}</dd>
              <dt>Template</dt>
              <dd>{selected?.template}</dd>
              <dt>Tenant</dt>
              <dd>{tenant}</dd>
              <dt>Excluded</dt>
              <dd>
                {selected && selected.exclude.length > 0 ? selected.exclude.join(', ') : 'none'}
              </dd>
            </dl>
            {preview.isLoading && <p className={styles.muted}>Rendering preview…</p>}
            {preview.error && <p className={styles.muted}>Preview unavailable.</p>}
            {preview.data && <pre className={styles.pre}>{preview.data.yaml}</pre>}
            {submitError && <p className={styles.error}>{submitError}</p>}
          </>
        )}

        <div className={styles.actions}>
          {step > 1 && (
            <Button
              title="general.back"
              type="outline"
              onClick={() => {
                setStep(step === 3 ? 2 : 1);
              }}
            />
          )}
          {step < 3 && (
            <Button
              title="general.next"
              type="primary"
              disabled={!canContinue}
              onClick={() => {
                setStep(step === 1 ? 2 : 3);
              }}
            />
          )}
          {step === 3 && (
            <Button
              title="general.create"
              type="primary"
              isLoading={submitting}
              disabled={!selected?.template || !tenant}
              onClick={() => {
                void create();
              }}
            />
          )}
        </div>
      </FormCardLayout>
      <section className={styles.guide} aria-label="Before you start">
        <h2 className={styles.sectionTitle}>Resources</h2>
        <div className={styles.guideGrid}>
          <article className={styles.guideTile}>
            <CubeIcon className={styles.guideIcon} aria-hidden="true" />
            <h3 className={styles.guideTitle}>Pick a template</h3>
            <p className={styles.guideText}>
              Foundation is the full platform, with high availability.
            </p>
            <a
              className={styles.guideLink}
              href="https://docs.meshx.io/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open docs
            </a>
          </article>
          <article className={styles.guideTile}>
            <BarGraphIcon className={styles.guideIcon} aria-hidden="true" />
            <h3 className={styles.guideTitle}>Check capacity</h3>
            <p className={styles.guideText}>
              See free CPU and memory on each node before you create a workspace.
            </p>
            <Link className={styles.guideLink} to="/infrastructure/capacity">
              Open capacity map
            </Link>
          </article>
          <article className={styles.guideTile}>
            <DocumentIcon className={styles.guideIcon} aria-hidden="true" />
            <h3 className={styles.guideTitle}>Review the YAML</h3>
            <p className={styles.guideText}>
              Every workspace renders a manifest you can read before anything is applied.
            </p>
            <a
              className={styles.guideLink}
              href="https://docs.meshx.io/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open docs
            </a>
          </article>
          <article className={styles.guideTile}>
            <ConnectionIcon className={styles.guideIcon} aria-hidden="true" />
            <h3 className={styles.guideTitle}>Set the tenant</h3>
            <p className={styles.guideText}>
              Use a lowercase tenant ID and choose the identity provider for the workspace.
            </p>
            <a
              className={styles.guideLink}
              href="https://docs.meshx.io/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open docs
            </a>
          </article>
        </div>
      </section>
    </>
  );
}

export default KuboWizard;
