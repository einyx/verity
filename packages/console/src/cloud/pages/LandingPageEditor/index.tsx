import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { z } from 'zod/v3';

import { type LandingPageVersion, useLandingPage } from '@/cloud/hooks/use-landing-page';
import useManageLandingPageGuard from '@/cloud/hooks/use-manage-landing-page-guard';

import ContentEditor, { isRecord } from './ContentEditor';
import { setAtPath } from './LandingPreviewFrame';
import PuckLandingPageEditor from './PuckLandingPageEditor';
import styles from './index.module.scss';

// Editor for the marketing site's copy. Changes save to the draft; nothing reaches the site until it
// is published. Section order and layout live in the site's code, so only the copy is edited here.
// Copy in this page is plain English on purpose: it sits behind the dev-feature flag, not translated.

/** Two clicks confirm a live change: the first arms it, the second runs it. */
type Pending = { kind: 'publish' } | { kind: 'rollback'; version: number } | undefined;

const demoChatLabel = 'Demo chat';

// One plain sentence per section, so the editor explains itself without a manual.
const demoChatHint = 'Turn the demo chat on or off. Off keeps the static request form on the site.';

// The publish conflict carries its HTTP status and nothing else the editor needs.
const publishConflictGuard = z.object({ status: z.literal(409) });

function LandingPageEditorContent() {
  const { data, error, saveDraft, publish, rollback, listVersions, refresh } = useLandingPage();
  const [draft, setDraft] = useState<unknown>();
  const [versions, setVersions] = useState<LandingPageVersion[]>([]);
  const [versionsError, setVersionsError] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [previewLocale, setPreviewLocale] = useState('en');

  useEffect(() => {
    if (data && draft === undefined) {
      setDraft(data.draft);
    }
  }, [data, draft]);

  useEffect(() => {
    const load = async () => {
      try {
        setVersions(await listVersions());
        setVersionsError(false);
      } catch {
        setVersions([]);
        setVersionsError(true);
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
      // A 409 status marks the publish conflict; other errors surface their own message.
      if (publishConflictGuard.safeParse(error_).success) {
        // Another editor saved first. Their draft is now the server's draft; re-read it and let this
        // editor review it before publishing.
        setMessage(
          'The draft changed while you were editing. Review the latest draft, save, and publish again.'
        );
        void refresh();
        return;
      }
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

  const publishLabel =
    pending?.kind === 'publish' ? 'Click again to confirm' : 'Publish to website';
  // Writes one edited field of the draft, by its dotted path from the draft root.
  const editField = (path: string, value: string) => {
    setDraft((current: unknown) => setAtPath(current, path, value));
  };

  // Saves where an image was dragged to, as its offset in the draft's layout.
  const moveImage = (id: string, offsetX: number, offsetY: number) => {
    setDraft((current: unknown) => {
      const record = isRecord(current) ? current : {};
      const layout = isRecord(record.layout) ? record.layout : {};

      return { ...record, layout: { ...layout, [id]: { x: offsetX, y: offsetY } } };
    });
  };

  return (
    // `fullWidthPage` opts this page out of the console's centred width cap.
    <div className={`${styles.shell} fullWidthPage`}>
      <div className={styles.content}>
        <aside className={styles.side}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Publish</h2>
            <div className={styles.statusRow}>
              {data?.publishedVersion ? (
                <span className={styles.liveBadge}>Live: version {data.publishedVersion}</span>
              ) : (
                <span className={styles.draftBadge}>Not published yet</span>
              )}
              {message && (
                <span role="status" className={styles.message}>
                  {message}
                </span>
              )}
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await saveDraft(currentDraft);
                  }, 'Draft saved.');
                }}
              >
                Save draft
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy}
                onClick={() => {
                  confirmOrRun(
                    { kind: 'publish' },
                    async () => {
                      const saved = await saveDraft(currentDraft);
                      await publish(saved.updatedAt);
                    },
                    'Published.'
                  );
                }}
              >
                {publishLabel}
              </button>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Earlier versions</h2>
            <p className={styles.sectionHint}>
              Each publish is kept. You can make an earlier one live again.
            </p>
            {versionsError && (
              <p role="alert" className={styles.error}>
                Could not load earlier versions. Reload the page to try again.
              </p>
            )}
            {!versionsError && versions.length === 0 && (
              <p className={styles.sectionHint}>
                {data?.publishedVersion
                  ? 'Loading earlier versions…'
                  : 'Nothing is published yet. Publish a draft to create the first version.'}
              </p>
            )}
            <ul className={styles.versions}>
              {versions.map((item) => (
                <li key={item.version} className={styles.versionRow}>
                  <span>
                    Version {item.version} by {item.publishedBy}
                  </span>
                  <span className={styles.sectionHint}>{item.createdAt}</span>
                  {item.version !== data?.publishedVersion && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
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
          </section>
        </aside>
        <div className={styles.main}>
          <header className={styles.header}>
            <h1 className={styles.title}>Landing page</h1>
            <p className={styles.subtitle}>
              Edit the live page in place. Save draft keeps changes private; publish puts them on
              the site.
            </p>
          </header>

          {isRecord(currentDraft) && 'demoChat' in currentDraft && (
            <section
              className={`${styles.section} ${styles.demoChatSection}`}
              aria-label="Demo chat content"
            >
              <header className={styles.sectionHeader}>
                <h2 className={styles.sectionName}>{demoChatLabel}</h2>
                <p className={styles.sectionHint}>{demoChatHint}</p>
              </header>
              <div className={styles.sectionBody}>
                <ContentEditor
                  label={demoChatLabel}
                  value={currentDraft.demoChat}
                  onChange={(value) => {
                    setDraft((current: unknown) => setAtPath(current, 'demoChat', value));
                  }}
                />
              </div>
            </section>
          )}

          <PuckLandingPageEditor
            document={currentDraft}
            locale={previewLocale}
            onLocaleChange={setPreviewLocale}
            onChange={setDraft}
            onEdit={editField}
            onMove={moveImage}
          />
        </div>
      </div>
    </div>
  );
}

// Rendered inside the console shell, which provides the sidebar, topbar, error boundary and scrolling.
function LandingPageEditor() {
  const ensureLandingPageScope = useManageLandingPageGuard();
  const [scopeReady, setScopeReady] = useState(false);

  useEffect(() => {
    const loadScope = async () => {
      setScopeReady(await ensureLandingPageScope());
    };
    void loadScope();
  }, [ensureLandingPageScope]);

  if (!scopeReady) {
    // When the guard returns false (e.g. no scope after attempted re-consent),
    // we render a non-destructive notice instead of nothing or the editor.
    // This avoids making authenticated API calls (useLandingPage etc) that would
    // 403 and (before the global handler fix) trigger a full sign-out.
    // The user stays signed in and can use the rest of the console.
    return (
      <>
        <Helmet title="Landing page" />
        <div style={{ padding: 24 }}>
          You do not have permission to manage the landing page, or the required scope has not been
          granted to your session yet.
        </div>
      </>
    );
  }

  return (
    <>
      <Helmet title="Landing page" />
      <LandingPageEditorContent />
    </>
  );
}

export default LandingPageEditor;
