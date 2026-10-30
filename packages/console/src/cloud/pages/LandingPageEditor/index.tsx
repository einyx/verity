import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { z } from 'zod/v3';

import { type LandingPageVersion, useLandingPage } from '@/cloud/hooks/use-landing-page';
import useManageLandingPageGuard from '@/cloud/hooks/use-manage-landing-page-guard';

import { isRecord } from './ContentEditor';
import { setAtPath } from './LandingPreviewFrame';
import PuckLandingPageEditor from './PuckLandingPageEditor';
import styles from './index.module.scss';

// Editor for the marketing site's copy. Changes save to the draft; nothing reaches the site until it
// is published. Section order and layout live in the site's code, so only the copy is edited here.
// Copy in this page is plain English on purpose: it sits behind the dev-feature flag, not translated.

/** Two clicks confirm a live change: the first arms it, the second runs it. */
type Pending = { kind: 'publish' } | { kind: 'rollback'; version: number } | undefined;

// The publish conflict carries its HTTP status and nothing else the editor needs.
const publishConflictGuard = z.object({ status: z.literal(409) });

function LandingPageEditorContent() {
  const { data, error, saveDraft, publish, rollback, generateEdit, listVersions, refresh } =
    useLandingPage();
  const [draft, setDraft] = useState<unknown>();
  const [versions, setVersions] = useState<LandingPageVersion[]>([]);
  const [versionsError, setVersionsError] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [previewLocale, setPreviewLocale] = useState('en');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string>();

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
    <div className={`${styles.shell} ${styles.topbarLayout} fullWidthPage`}>
      <div className={styles.editorTopbar}>
        <h1 className={styles.topbarTitle}>Landing page</h1>
        <span className={data?.publishedVersion ? styles.liveBadge : styles.draftBadge}>
          {data?.publishedVersion ? `Live: version ${data.publishedVersion}` : 'Not published yet'}
        </span>
        {message && (
          <span role="status" className={styles.message}>
            {message}
          </span>
        )}
        {isRecord(currentDraft) && 'demoChat' in currentDraft && (
          <section aria-label="Demo chat content" className={styles.demoChatToggle}>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={isRecord(currentDraft.demoChat) && currentDraft.demoChat.enabled === true}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setDraft((current: unknown) => setAtPath(current, 'demoChat.enabled', enabled));
                }}
              />
              <span>Demo chat on the site</span>
            </label>
          </section>
        )}
        <details className={styles.versionsMenu}>
          <summary className={styles.versionsSummary}>
            Versions{versions.length > 0 ? ` · ${versions.length}` : ''}
          </summary>
          <div className={styles.versionsPop}>
            {versionsError && (
              <p role="alert" className={styles.error}>
                Could not load earlier versions. Reload the page to try again.
              </p>
            )}
            {!versionsError && versions.length === 0 && (
              <p className={styles.sectionHint}>
                {data?.publishedVersion
                  ? 'No earlier versions kept yet.'
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
          </div>
        </details>
        <div className={styles.topbarActions}>
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
      </div>
      <form
        className={styles.aiEdit}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!aiInstruction.trim() || aiBusy) {
            return;
          }
          setAiBusy(true);
          setAiError(undefined);
          try {
            setDraft(await generateEdit(aiInstruction.trim(), currentDraft));
          } catch (error_: unknown) {
            setAiError(error_ instanceof Error ? error_.message : 'AI edit failed. Try again.');
          } finally {
            setAiBusy(false);
          }
        }}
      >
        <label htmlFor="landing-page-ai-edit">Ask AI to edit this draft</label>
        <input
          id="landing-page-ai-edit"
          value={aiInstruction}
          maxLength={2000}
          placeholder="Describe the change you want…"
          onChange={(event) => {
            setAiInstruction(event.target.value);
          }}
        />
        <button
          type="submit"
          className={styles.secondaryButton}
          disabled={aiBusy || !aiInstruction.trim()}
        >
          {aiBusy ? 'Working…' : 'Suggest edit'}
        </button>
        {aiError && <span role="alert">{aiError}</span>}
        <span role="status">
          Suggestions update the preview only. Save draft to keep them; publishing is separate.
        </span>
      </form>
      <PuckLandingPageEditor
        document={currentDraft}
        locale={previewLocale}
        onLocaleChange={setPreviewLocale}
        onChange={setDraft}
        onEdit={editField}
        onMove={moveImage}
      />
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
