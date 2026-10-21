import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';

import { type LandingPageVersion, useLandingPage } from '@/cloud/hooks/use-landing-page';

import ContentEditor, { isRecord } from './ContentEditor';
import LandingPreviewFrame, { setAtPath } from './LandingPreviewFrame';
import NavArtwork from './NavArtwork';
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
  demoChat: 'Demo chat',
};

// One plain sentence per section, so the editor explains itself without a manual.
const sectionHints: Record<string, string> = {
  hero: 'The first thing visitors see: the big headline, intro text and the two main buttons.',
  fomo: 'The "missing layer" block that explains what teams lose without meshX.',
  howItWorks: 'The short "how it works" explanation with its button.',
  agents: 'The six example questions people can ask the AI agents.',
  platform: 'The section that describes the platform.',
  products: 'The product cards, each with a button.',
  industries: 'The two industry cards, each with a button.',
  stories: 'The customer story and its key facts.',
  why: 'Why teams choose meshX, with the comparison rows.',
  trust: 'The four commitments about security and control.',
  closingCta: 'The last call to action at the bottom of the page.',
  demoChat: 'Turn the demo chat on or off. Off keeps the static request form on the site.',
};

function LandingPageEditorContent() {
  const { data, error, saveDraft, publish, rollback, listVersions } = useLandingPage();
  const [draft, setDraft] = useState<unknown>();
  const [versions, setVersions] = useState<LandingPageVersion[]>([]);
  const [versionsError, setVersionsError] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [activeKey, setActiveKey] = useState<string>();

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
  const sectionEntries = isRecord(currentDraft) ? Object.entries(currentDraft) : [];
  const selectedKey = sectionEntries.some(([key]) => key === activeKey)
    ? activeKey
    : sectionEntries[0]?.[0];
  const selected = sectionEntries.find(([key]) => key === selectedKey);

  // Writes one edited field of the draft, by its dotted path from the draft root.
  const editField = (path: string, value: string) => {
    setDraft((current: unknown) => setAtPath(current, path, value));
  };

  return (
    // `fullWidthPage` opts this page out of the console's centred width cap.
    <div className={`${styles.shell} fullWidthPage`}>
      <nav className={styles.nav} aria-label="Sections">
        <div className={styles.navHeading}>Sections</div>
        {sectionEntries.map(([key]) => (
          <button
            key={key}
            type="button"
            className={styles.navItem}
            aria-current={key === selectedKey ? 'true' : undefined}
            onClick={() => {
              setActiveKey(key);
            }}
          >
            {sectionLabels[key] ?? key}
          </button>
        ))}
        <div className={styles.navArtwork} aria-hidden="true">
          <NavArtwork />
        </div>
      </nav>

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
                  void run(async () => saveDraft(currentDraft), 'Draft saved.');
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
                      await saveDraft(currentDraft);
                      await publish();
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
              Edit the words on the marketing site. Save draft keeps your changes private. Publish
              puts them on the site.
            </p>
          </header>

          {selected && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionName}>{sectionLabels[selected[0]] ?? selected[0]}</h2>
                <p className={styles.sectionHint}>{sectionHints[selected[0]]}</p>
              </div>
              <div className={styles.sectionBody}>
                <ContentEditor
                  label=""
                  value={selected[1]}
                  onChange={(next) => {
                    setDraft({ ...currentDraft, [selected[0]]: next });
                  }}
                />
              </div>
            </section>
          )}

          <LandingPreviewFrame draft={draft} onEdit={editField} />
        </div>
      </div>
    </div>
  );
}

// Rendered inside the console shell, which provides the sidebar, topbar, error boundary and scrolling.
function LandingPageEditor() {
  return (
    <>
      <Helmet title="Landing page" />
      <LandingPageEditorContent />
    </>
  );
}

export default LandingPageEditor;
