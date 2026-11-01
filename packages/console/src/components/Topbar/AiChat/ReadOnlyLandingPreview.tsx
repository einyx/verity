import { type LandingPageDocument } from '@logto/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';

import { draftChanges } from '@/cloud/pages/LandingPageEditor/draft-changes';

import styles from './index.module.scss';

/** Render only our trusted preview route. Model output is data, never HTML or an iframe URL. */
function ReadOnlyLandingPreview({
  document,
  isExpanded = false,
}: {
  readonly document: LandingPageDocument;
  readonly isExpanded?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [section, setSection] = useState(document.sections[0]?.id ?? 'hero');
  const send = useCallback(() => {
    const target = frame.current?.contentWindow;
    target?.postMessage({ type: 'meshx-cms-draft', doc: document }, window.location.origin);
    target?.postMessage({ type: 'meshx-cms-locale', code: 'en' }, window.location.origin);
    target?.postMessage(
      { type: 'meshx-cms-select-section', sectionId: section },
      window.location.origin
    );
  }, [document, section]);

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
        event.data.type === 'meshx-cms-ready'
      ) {
        send();
      }
    };
    window.addEventListener('message', ready);
    return () => {
      window.removeEventListener('message', ready);
    };
  }, [send]);

  return (
    <div className={styles.artifactViewport} data-expanded={isExpanded}>
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
        src={`${window.location.origin}/console/landing-preview?cmsPreview=1`}
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
