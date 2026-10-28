import { useCallback, useEffect, useRef } from 'react';

import type { ElementField, LandingElementSelection } from './LandingElementModel';
import { handlePreviewMessage } from './LandingPreviewMessages';
import { type LandingSectionType } from './LandingSectionTypes';
import styles from './index.module.scss';

// Sets one field of the draft by its dotted path, such as `hero.headline.0`. Objects and arrays along the
// path are copied, so the draft stays immutable.
export { setAtPath } from './LandingElementModel';

/**
 * The real landing page in an iframe. The draft is sent in, and text edited on the page is sent back to
 * the editor, so the page is edited where it is shown.
 */
function LandingPreviewFrame({
  width,
  draft,
  locale,
  activeSection,
  onEdit,
  onSelectLink,
  onMove,
  onAddSection,
  onSelectElement,
  onElementEdit,
  onSectionAction,
}: {
  readonly width: number;
  readonly draft: unknown;
  /** The language the preview shows, and the one that edits are saved under. */
  readonly locale: string;
  readonly activeSection: string;
  readonly onEdit: (path: string, value: string) => void;
  readonly onSelectLink: (path: string) => void;
  readonly onSelectElement: (selection: LandingElementSelection) => void;
  readonly onElementEdit: (
    selection: LandingElementSelection,
    field: ElementField,
    value: unknown
  ) => void;
  readonly onSectionAction: (sectionId: string, action: string) => void;
  readonly onMove: (id: string, x: number, y: number) => void;
  readonly onAddSection: (
    type: LandingSectionType,
    targetSectionId?: string,
    position?: 'before' | 'after' | 'end'
  ) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const sendDraft = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'meshx-cms-draft', doc: draft },
      window.location.origin
    );
  }, [draft]);

  const sendLocale = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'meshx-cms-locale', code: locale },
      window.location.origin
    );
  }, [locale]);

  const sendActiveSection = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'meshx-cms-select-section', sectionId: activeSection },
      window.location.origin
    );
  }, [activeSection]);

  useEffect(() => {
    sendDraft();
  }, [sendDraft]);

  useEffect(() => {
    sendLocale();
  }, [sendLocale]);

  useEffect(() => {
    sendActiveSection();
  }, [sendActiveSection]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frameRef.current?.contentWindow
      ) {
        return;
      }

      handlePreviewMessage(event.data, {
        onReady: () => {
          sendDraft();
          sendLocale();
        },
        onEdit,
        onSelectLink,
        onSelectElement,
        onElementEdit,
        onSectionAction,
        onAddSection,
        onMove,
      });
    };

    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [
    onAddSection,
    onEdit,
    onMove,
    onSelectLink,
    onSelectElement,
    onElementEdit,
    onSectionAction,
    sendDraft,
    sendLocale,
  ]);

  return (
    <>
      <button
        type="button"
        className={styles.previewActionsButton}
        aria-haspopup="menu"
        onClick={() => {
          frameRef.current?.contentWindow?.postMessage(
            { type: 'meshx-cms-open-actions' },
            window.location.origin
          );
        }}
      >
        Actions
      </button>
      {/* The landing page is our own static site on this origin. It must run its scripts and make
          same-origin requests to load its copy and report edits, so a sandbox that combines both flags
          would stop it working. */}
      {/* eslint-disable-next-line react/iframe-missing-sandbox -- see the comment above. */}
      <iframe
        ref={frameRef}
        className={styles.pageFrame}
        style={{ width }}
        src={`${window.location.origin}/console/landing-preview?cmsPreview=1`}
        title="Landing page preview"
        onLoad={(event) => {
          sendDraft();
          sendActiveSection();
          event.currentTarget.contentWindow?.postMessage(
            { type: 'meshx-cms-editor-viewport', height: Math.round(window.innerHeight * 0.72) },
            window.location.origin
          );
        }}
      />
    </>
  );
}

export default LandingPreviewFrame;
