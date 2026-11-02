import { type LandingPageDocument } from '@logto/schemas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { draftChanges } from '@/cloud/pages/LandingPageEditor/draft-changes';

import styles from './index.module.scss';

/** Render only our trusted preview route. Model output is data, never HTML or an iframe URL. */
function ReadOnlyLandingPreview({
  document,
  id,
  isExpanded = false,
}: {
  readonly document: LandingPageDocument;
  readonly id?: string;
  readonly isExpanded?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const nonce = useMemo(
    () =>
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join(''),
    []
  );
  const [section, setSection] = useState(document.sections[0]?.id ?? 'hero');
  const send = useCallback(() => {
    const target = frame.current?.contentWindow;
    target?.postMessage({ type: 'meshx-cms-draft', doc: document, nonce }, window.location.origin);
    target?.postMessage({ type: 'meshx-cms-locale', code: 'en', nonce }, window.location.origin);
    target?.postMessage(
      { type: 'meshx-cms-select-section', sectionId: section, nonce },
      window.location.origin
    );
  }, [document, section, nonce]);

  useEffect(() => {
    send();
  }, [send]);
  useEffect(() => {
    const ready = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      ) {
        return;
      }
      if (
        typeof event.data === 'object' &&
        event.data !== null &&
        'type' in event.data &&
        event.data.type === 'meshx-cms-ready' &&
        'nonce' in event.data &&
        event.data.nonce === nonce
      ) {
        send();
      }
    };
    window.addEventListener('message', ready);
    return () => {
      window.removeEventListener('message', ready);
    };
  }, [send, nonce]);

  return (
    <div id={id} className={styles.artifactViewport} data-expanded={isExpanded}>
      <label className={styles.artifactSectionPicker}>
        Preview section
        <select
          value={section}
          onChange={(event) => {
            setSection(event.target.value);
          }}
        >
          {document.sections.map((item, index) => (
            <option key={item.id} value={item.id}>
              {index + 1}. {item.type} · {item.id}
            </option>
          ))}
        </select>
      </label>
      {/* eslint-disable-next-line react/iframe-missing-sandbox -- The trusted same-origin CMS renderer needs scripts and its origin for draft messages; neither HTML nor the frame URL comes from the model. */}
      <iframe
        ref={frame}
        inert
        title="Proposed landing page preview"
        tabIndex={-1}
        aria-hidden="true"
        sandbox="allow-scripts allow-same-origin"
        src={`${window.location.origin}/console/landing-preview?cmsPreview=1&cmsReadOnly=1&cmsNonce=${nonce}`}
        className={styles.artifactFrame}
        onLoad={send}
      />
      <details className={styles.artifactCopy}>
        <summary>Read proposed section</summary>
        <dl>
          {draftChanges(
            {},
            document.sections.find((item) => item.id === section)
          ).map((field) => (
            <div key={field.path}>
              <dt>{field.path}</dt>
              <dd>{field.after}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export default ReadOnlyLandingPreview;
