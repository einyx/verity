import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { z } from 'zod/v3';

import { type LandingPageVersion, useLandingPage } from '@/cloud/hooks/use-landing-page';
import useManageLandingPageGuard from '@/cloud/hooks/use-manage-landing-page-guard';

import AiEditPanel from './AiEditPanel';
import { isRecord } from './ContentEditor';
import EditorToolbar from './EditorToolbar';
import HistoryPreview from './HistoryPreview';
import { setAtPath } from './LandingPreviewFrame';
import PublicationReview from './PublicationReview';
import PuckLandingPageEditor from './PuckLandingPageEditor';
import SavedDraftNotice from './SavedDraftNotice';
import styles from './index.module.scss';
import useDraftSession, { documentsEqual } from './use-draft-session';

// Editor for the marketing site's copy. Changes save to the draft; nothing reaches the site until it
// is published. Section order and layout live in the site's code, so only the copy is edited here.
// Copy in this page is plain English on purpose: it sits behind the dev-feature flag, not translated.

type Pending =
  | {
      snapshot: unknown;
      published: unknown;
      publishedVersion?: number;
      restoreVersion?: number;
    }
  | undefined;

// The publish conflict carries its HTTP status and nothing else the editor needs.
const publishConflictGuard = z.object({ status: z.literal(409) });

function LandingPageEditorContent() {
  const { data, error, saveDraft, publish, rollback, generateEdit, listVersions, refresh } =
    useLandingPage();
  const {
    draft,
    setDraft,
    isDirty,
    markSaved,
    hasRemoteUpdate,
    incomingDraft,
    acceptRemote,
    keepLocal,
  } = useDraftSession(data?.draft);
  const [versions, setVersions] = useState<LandingPageVersion[]>([]);
  const [versionsError, setVersionsError] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [previewLocale, setPreviewLocale] = useState('en');
  const [aiOpen, setAiOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');
  const [saving, setSaving] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<LandingPageVersion>();
  const closeHistoryPreview = () => {
    setHistoryPreview(undefined);
    document.querySelector<HTMLElement>('[data-history-trigger]')?.focus();
  };

  const saveDocument = async (document: unknown) => {
    setSaving(true);
    try {
      const saved = await saveDraft(document);
      markSaved(document);
      return saved;
    } finally {
      setSaving(false);
    }
  };

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
    if (busyRef.current) {
      return false;
    }
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Prevent duplicate writes before React has rendered the disabled controls.
    busyRef.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
      setMessage(success);
      return true;
    } catch (error_: unknown) {
      // A 409 status marks the publish conflict; other errors surface their own message.
      if (publishConflictGuard.safeParse(error_).success) {
        // Another editor saved first. Their draft is now the server's draft; re-read it and let this
        // editor review it before publishing.
        setMessage(
          'The draft changed while you were editing. Review the latest draft, save, and publish again.'
        );
        void refresh();
        setPending(undefined);
        return false;
      }
      setMessage(error_ instanceof Error ? error_.message : String(error_));
      return false;
    } finally {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Release the synchronous write lock after the request settles.
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (error && !data) {
    return <div className={styles.notice}>{error.message}</div>;
  }

  if (draft === undefined) {
    return <div className={styles.notice}>Loading…</div>;
  }

  const currentDraft = draft;

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
      <EditorToolbar
        draft={currentDraft}
        status={saving ? 'Saving…' : isDirty ? 'Unsaved changes' : 'Draft saved'}
        publishedVersion={data?.publishedVersion ?? undefined}
        versions={versions}
        hasVersionsError={versionsError}
        isBusy={busy}
        isViewingHistory={Boolean(historyPreview)}
        onPreviewVersion={(version) => {
          const selected = versions.find((item) => item.version === version);
          if (selected) {
            setHistoryPreview(selected);
          }
        }}
        onDraftChange={setDraft}
        onSave={() => {
          void run(async () => {
            await saveDocument(currentDraft);
          }, 'Draft saved.');
        }}
        onPublish={() => {
          setMessage(undefined);
          setPending({
            snapshot: currentDraft,
            published: data?.published,
            publishedVersion: data?.publishedVersion ?? undefined,
          });
        }}
        onRollback={(version) => {
          const target = versions.find((item) => item.version === version);
          if (!target) {
            return;
          }
          setMessage(undefined);
          setPending({
            snapshot: target.document,
            published: data?.published,
            publishedVersion: data?.publishedVersion ?? undefined,
            restoreVersion: version,
          });
        }}
        onEditWithAi={() => {
          setAiOpen(true);
        }}
      />
      {error && data && (
        <p role="alert" className={styles.error}>
          Could not refresh the saved draft. Your local edits are still here. Reload when your
          connection is restored.
        </p>
      )}
      {hasRemoteUpdate && (
        <SavedDraftNotice
          local={currentDraft}
          incoming={incomingDraft}
          onLoad={() => {
            acceptRemote();
            setHistoryPreview(undefined);
          }}
          onKeep={keepLocal}
        />
      )}
      {message && !pending && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      {aiOpen && (
        <AiEditPanel
          draft={currentDraft}
          scope={`Section ${activeSection}`}
          generateEdit={generateEdit}
          isDisabled={busy || Boolean(historyPreview)}
          onApply={setDraft}
          onClose={() => {
            setAiOpen(false);
          }}
        />
      )}
      {historyPreview && (
        <HistoryPreview
          key={historyPreview.version}
          version={historyPreview}
          currentDraft={currentDraft}
          publishedVersion={data?.publishedVersion ?? undefined}
          onClose={closeHistoryPreview}
          onRestore={(restored) => {
            setDraft(restored);
            setMessage(
              `Version ${historyPreview.version} restored to your draft. Save draft to keep it; the website has not changed.`
            );
            closeHistoryPreview();
          }}
        />
      )}
      <div hidden={Boolean(historyPreview)}>
        <PuckLandingPageEditor
          document={currentDraft}
          locale={previewLocale}
          onLocaleChange={setPreviewLocale}
          onChange={setDraft}
          onEdit={editField}
          onMove={moveImage}
          onActiveSectionChange={setActiveSection}
        />
      </div>
      {pending && (
        <PublicationReview
          {...pending}
          currentDraft={currentDraft}
          liveVersion={data?.publishedVersion ?? undefined}
          isBusy={busy}
          message={message}
          onCancel={() => {
            if (!busy) {
              setPending(undefined);
            }
          }}
          onConfirm={async () => {
            if (
              busy ||
              (pending.restoreVersion === undefined &&
                !documentsEqual(pending.snapshot, currentDraft))
            ) {
              return;
            }
            const reviewed = pending;
            const succeeded = await run(
              async () => {
                if (reviewed.restoreVersion !== undefined) {
                  await rollback(reviewed.restoreVersion);
                  return;
                }
                const saved = await saveDocument(reviewed.snapshot);
                await publish(saved.updatedAt);
              },
              reviewed.restoreVersion === undefined
                ? 'Published.'
                : `Version ${reviewed.restoreVersion} is live.`
            );
            if (succeeded) {
              setPending(undefined);
            }
          }}
        />
      )}
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
