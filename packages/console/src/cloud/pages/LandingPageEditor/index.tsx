import { useEffect, useState } from 'react';

import { type LandingPageVersion, useLandingPage } from '@/cloud/hooks/use-landing-page';
import Topbar from '@/components/Topbar';
import AppBoundary from '@/containers/AppBoundary';
import OverlayScrollbar from '@/ds-components/OverlayScrollbar';

import ContentEditor, { isRecord } from './ContentEditor';
import styles from './index.module.scss';

// Editor for the marketing site's copy. Changes save to the draft; nothing reaches the site until it
// is published. Section order and layout live in the site's code, so only the copy is edited here.
// Copy in this page is plain English on purpose: it sits behind the dev-feature flag, not translated.

/** Two clicks confirm a live change: the first arms it, the second runs it. */
type Pending = { kind: 'publish' } | { kind: 'rollback'; version: number } | undefined;

const sectionLabels: Record<string, string> = {
  hero: 'Hero',
  fomo: 'Missing layer',
  howItWorks: 'How it works',
  agents: 'Agents',
  platform: 'Platform',
  products: 'Products',
  industries: 'Industries',
  stories: 'Success stories',
  why: 'Why meshX',
  trust: 'Security',
  closingCta: 'Closing call to action',
};

function LandingPageEditorContent() {
  const { data, error, saveDraft, publish, rollback, listVersions } = useLandingPage();
  const [draft, setDraft] = useState<unknown>();
  const [versions, setVersions] = useState<LandingPageVersion[]>([]);
  const [message, setMessage] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && draft === undefined) {
      setDraft(data.draft);
    }
  }, [data, draft]);

  useEffect(() => {
    const load = async () => {
      try {
        setVersions(await listVersions());
      } catch {
        setVersions([]);
      }
    };
    void load();
  }, [listVersions, data?.publishedVersion]);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
      setMessage(success);
    } catch (error_: unknown) {
      setMessage(error_ instanceof Error ? error_.message : String(error_));
    } finally {
      setBusy(false);
    }
  };

  const isSamePending = (current: Pending, next: Exclude<Pending, undefined>) => {
    if (current?.kind !== next.kind) {
      return false;
    }
    return (
      next.kind === 'publish' || (current.kind === 'rollback' && current.version === next.version)
    );
  };

  const confirmOrRun = (
    next: Exclude<Pending, undefined>,
    action: () => Promise<void>,
    success: string
  ) => {
    if (isSamePending(pending, next)) {
      setPending(undefined);
      void run(action, success);
      return;
    }
    setPending(next);
  };

  if (error) {
    return <div className={styles.notice}>{error.message}</div>;
  }

  if (draft === undefined) {
    return <div className={styles.notice}>Loading…</div>;
  }

  const currentDraft = draft;

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(async () => saveDraft(currentDraft), 'Draft saved.');
          }}
        >
          Save draft
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            confirmOrRun(
              { kind: 'publish' },
              async () => {
                await saveDraft(currentDraft);
                await publish();
              },
              'Published.'
            );
          }}
        >
          {pending?.kind === 'publish' ? 'Click again to publish' : 'Publish'}
        </button>
        {data?.publishedVersion && <span>Live: version {data.publishedVersion}</span>}
        {message && <span role="status">{message}</span>}
      </div>

      {(isRecord(currentDraft) ? Object.entries(currentDraft) : []).map(([key, section]) => (
        <section key={key} className={styles.section}>
          <h3>{sectionLabels[key] ?? key}</h3>
          <ContentEditor
            label=""
            value={section}
            onChange={(next) => {
              setDraft({ ...currentDraft, [key]: next });
            }}
          />
        </section>
      ))}

      <h3>Published versions</h3>
      {versions.length === 0 && <p>No published versions yet.</p>}
      <ul className={styles.versions}>
        {versions.map((item) => (
          <li key={item.version}>
            Version {item.version} by {item.publishedBy} at {item.createdAt}
            {item.version !== data?.publishedVersion && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  confirmOrRun(
                    { kind: 'rollback', version: item.version },
                    async () => rollback(item.version),
                    `Version ${item.version} is live.`
                  );
                }}
              >
                {pending?.kind === 'rollback' && pending.version === item.version
                  ? 'Click again to make live'
                  : 'Make live'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LandingPageEditor() {
  return (
    <>
      <Topbar />
      <AppBoundary>
        <OverlayScrollbar>
          <LandingPageEditorContent />
        </OverlayScrollbar>
      </AppBoundary>
    </>
  );
}

export default LandingPageEditor;
