import { useCallback, useEffect, useRef } from 'react';

import { isRecord } from './ContentEditor';
import styles from './index.module.scss';

// Sets one field of the draft by its dotted path, such as `hero.headline.0`. Objects and arrays along the
// path are copied, so the draft stays immutable.
export const setAtPath = (source: unknown, path: string, value: string): unknown => {
  // `''.split('.')` is `['']`, not `[]`, so the empty path must be checked explicitly. Without this, the
  // last segment recurses into an empty path forever.
  if (path === '') {
    return value;
  }

  const [key, ...rest] = path.split('.');

  if (key === undefined) {
    return value;
  }

  if (Array.isArray(source)) {
    const index = Number(key);

    return source.map((item: unknown, position) =>
      position === index ? setAtPath(item, rest.join('.'), value) : item
    );
  }

  const record = isRecord(source) ? source : {};

  return { ...record, [key]: setAtPath(record[key], rest.join('.'), value) };
};

/**
 * The real landing page in an iframe. The draft is sent in, and text edited on the page is sent back to
 * the editor, so the page is edited where it is shown.
 */
function LandingPreviewFrame({
  draft,
  locale,
  onEdit,
  onMove,
}: {
  readonly draft: unknown;
  /** The language the preview shows, and the one that edits are saved under. */
  readonly locale: string;
  readonly onEdit: (path: string, value: string) => void;
  readonly onMove: (id: string, x: number, y: number) => void;
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

  useEffect(() => {
    sendDraft();
  }, [sendDraft]);

  useEffect(() => {
    sendLocale();
  }, [sendLocale]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frameRef.current?.contentWindow
      ) {
        return;
      }

      const { data } = event;

      if (!isRecord(data)) {
        return;
      }

      if (data.type === 'meshx-cms-ready') {
        sendDraft();
        sendLocale();
      }

      if (data.type === 'meshx-cms-edit' && typeof data.path === 'string') {
        onEdit(data.path, typeof data.value === 'string' ? data.value : '');
      }

      // Offsets are clamped to the range the document schema accepts, so a bad message cannot save an
      // invalid layout.
      if (
        data.type === 'meshx-cms-move' &&
        typeof data.id === 'string' &&
        typeof data.x === 'number' &&
        typeof data.y === 'number'
      ) {
        const clamp = (value: number) => Math.min(400, Math.max(-400, Math.round(value)));
        onMove(data.id, clamp(data.x), clamp(data.y));
      }
    };

    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [onEdit, onMove, sendDraft, sendLocale]);

  return (
    <>
      {/* The landing page is our own static site on this origin. It must run its scripts and make
          same-origin requests to load its copy and report edits, so a sandbox that combines both flags
          would stop it working. */}
      {/* eslint-disable-next-line react/iframe-missing-sandbox -- see the comment above. */}
      <iframe
        ref={frameRef}
        className={styles.pageFrame}
        src="/?cmsPreview=1"
        title="Landing page preview"
        onLoad={sendDraft}
      />
    </>
  );
}

export default LandingPreviewFrame;
