/* eslint-disable max-lines -- The wizard's steps and resource cards live in one screen; split it into step components before lowering this limit. */
import { useState } from 'react';
import { Helmet } from 'react-helmet';
import useSWR from 'swr';

import BarGraphIcon from '@/assets/icons/bar-graph.svg?react';
import BookIcon from '@/assets/icons/book.svg?react';
import ConnectionIcon from '@/assets/icons/connection.svg?react';
import CubeIcon from '@/assets/icons/cube.svg?react';
import DocumentIcon from '@/assets/icons/document.svg?react';
import FormCardLayout from '@/components/FormCard/FormCardLayout';
import Button from '@/ds-components/Button';
import Select from '@/ds-components/Select';
import useApi, { type RequestError } from '@/hooks/use-api';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import ChoiceItem from './ChoiceItem';
import { StepIntro } from './StepIntro';
import { readError } from './errors';
import { type StackOption, stackOptions, templateHighlights, toStep } from './options';
import wizardStyles from './wizard.module.scss';

// Lowercase RFC-1123 label, as the portal requires for a tenant ID.
const documentationUrl = 'https://docs.meshx.io/';

// What is missing before the Next button enables, shown beside it.
const continueHints: Record<1 | 2 | 3, string> = {
  1: 'Choose a template to continue.',
  2: 'Enter a valid tenant ID to continue.',
  3: '',
};

// The components a template leaves out, or "none" for a complete template.
const describeExcluded = (option?: StackOption) =>
  option && option.exclude.length > 0 ? option.exclude.join(', ') : 'none';

// Resource cards below the wizard. Copy follows ASD-STE100: short sentences, one instruction each.

const resourceCards = [
  {
    icon: CubeIcon,
    title: 'Choose a template',
    text: 'Select a template. Foundation is the full platform. It has high availability.',
    action: { label: 'Open docs', href: documentationUrl },
  },
  {
    icon: BarGraphIcon,
    title: 'Check capacity',
    text: 'Check the free CPU and memory on each node. Do this before you create a workspace.',
    action: { label: 'Open capacity map', href: '/infrastructure/capacity' },
  },
  {
    icon: DocumentIcon,
    title: 'Review the YAML',
    text: 'The workspace shows a YAML manifest. Read it before you apply it.',
    action: { label: 'Open docs', href: documentationUrl },
  },
  {
    icon: ConnectionIcon,
    title: 'Set the tenant',
    text: 'Use a lowercase tenant ID. Select the sign-in provider for the workspace.',
    action: { label: 'Open docs', href: documentationUrl },
  },
] as const;

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
  // Tenant-aware navigate, so the redirect stays under /<tenant>/console instead of the marketing root.
  const { navigate } = useTenantPathname();
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

  return (
    <div className={wizardStyles.page}>
      <Helmet title="MeshX · New workspace" />
      <div className={wizardStyles.stats}>
        <div className={wizardStyles.stat}>
          <div className={wizardStyles.statLabel}>Workspaces</div>
          <div className={wizardStyles.statValue}>{workspaceTotal ?? '–'}</div>
        </div>
        <div className={wizardStyles.stat}>
          <div className={wizardStyles.statLabel}>Ready</div>
          <div className={wizardStyles.statValue}>{workspaceReady ?? '–'}</div>
        </div>
      </div>
      {workspaceTotal === 0 && (
        <section className={wizardStyles.callout} aria-label="Getting started">
          <h2 className={wizardStyles.calloutTitle}>Create your first workspace</h2>
          <p className={wizardStyles.calloutText}>
            Start with Foundation for the full platform. Choose a template, set the tenant, then
            review the YAML before anything is applied. Your workspace will appear under Workspaces
            once it’s created.
          </p>
        </section>
      )}
      <FormCardLayout
        introduction={
          <StepIntro
            step={step}
            onStepChange={(number) => {
              setStep(toStep(number));
            }}
          />
        }
      >
        <div className={wizardStyles.progress} aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((number) => (
            <span key={number} className={step >= number ? wizardStyles.progressOn : undefined} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h2 className={wizardStyles.sectionTitle}>Templates</h2>
            <p className={wizardStyles.recommendation}>
              Recommended for most teams: <strong>Foundation</strong>. Dashboards AI and Foundation
              AI are smaller, single-purpose setups.
            </p>
            <ul className={wizardStyles.templateGrid}>
              {stackOptions.map((option) => (
                <li key={option.id} className={wizardStyles.templateItem}>
                  {templateHighlights[option.id].recommended && (
                    <span className={wizardStyles.badge}>Recommended</span>
                  )}
                  <ChoiceItem
                    option={option}
                    selected={selected}
                    onSelect={() => {
                      setSelected(option);
                    }}
                  />
                  <ul className={wizardStyles.tags}>
                    {templateHighlights[option.id].tags.map((tag) => (
                      <li key={tag} className={wizardStyles.tag}>
                        {tag}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 2 && (
          <div className={wizardStyles.form}>
            <label className={wizardStyles.field}>
              Tenant ID
              <span className={wizardStyles.hint}>
                A short, lowercase name for this workspace, such as acme.
              </span>
              <input
                value={tenant}
                placeholder="acme"
                onChange={(event) => {
                  setTenant(event.target.value.trim().toLowerCase());
                }}
              />
              {tenant && !tenantValid && (
                <span className={wizardStyles.error}>
                  Use lowercase letters, digits and hyphens. Start and end with a letter or digit.
                </span>
              )}
            </label>
            <div className={wizardStyles.field}>
              Sign-in provider
              <span className={wizardStyles.hint}>
                Where your users sign in. Logto is recommended.
              </span>
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
            <label className={wizardStyles.field}>
              Deployment mode (optional)
              <span className={wizardStyles.hint}>
                Leave this blank unless your team uses a specific mode.
              </span>
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
            <dl className={wizardStyles.budget}>
              <dt>Type</dt>
              <dd>{selected?.title}</dd>
              <dt>Template</dt>
              <dd>{selected?.template}</dd>
              <dt>Tenant</dt>
              <dd>{tenant}</dd>
              <dt>Excluded</dt>
              <dd>{describeExcluded(selected)}</dd>
            </dl>
            {preview.isLoading && <p className={wizardStyles.muted}>Rendering preview…</p>}
            {preview.error && <p className={wizardStyles.muted}>Preview unavailable.</p>}
            {preview.data && <pre className={wizardStyles.pre}>{preview.data.yaml}</pre>}
            {submitError && <p className={wizardStyles.error}>{submitError}</p>}
          </>
        )}

        <div className={wizardStyles.actions}>
          {step < 3 && !canContinue && <p className={wizardStyles.hint}>{continueHints[step]}</p>}
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
      <section className={wizardStyles.resourcesSection} aria-label="Resources">
        <h2 className={wizardStyles.resourcesTitle}>Resources</h2>
        <div className={wizardStyles.resourceGrid}>
          {resourceCards.map((card) => (
            <article key={card.title} className={wizardStyles.resourceCard}>
              <div className={wizardStyles.resourceHeader}>
                <card.icon className={wizardStyles.resourceIcon} aria-hidden="true" />
                <h3 className={wizardStyles.resourceName}>{card.title}</h3>
              </div>
              <p className={wizardStyles.resourceText}>{card.text}</p>
              <a
                className={wizardStyles.resourceButton}
                href={card.action.href}
                target={card.action.href.startsWith('/') ? undefined : '_blank'}
                rel={card.action.href.startsWith('/') ? undefined : 'noopener noreferrer'}
              >
                <BookIcon className={wizardStyles.resourceBook} aria-hidden="true" />
                {card.action.label}
              </a>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default KuboWizard;
/* eslint-enable max-lines */
