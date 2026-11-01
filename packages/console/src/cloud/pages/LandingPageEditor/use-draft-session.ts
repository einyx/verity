import { useCallback, useEffect, useState } from 'react';

import { isRecord } from './ContentEditor';

const serialized = (value: unknown) =>
  JSON.stringify(value, (_key, entry: unknown) =>
    isRecord(entry)
      ? Object.fromEntries(
          Object.entries(entry)
            .slice()
            .sort(([left], [right]) => left.localeCompare(right))
        )
      : entry
  );

export const documentsEqual = (left: unknown, right: unknown) =>
  serialized(left) === serialized(right);

/** Follow saved updates when clean; never erase unsaved typing when a remote draft changes. */
const useDraftSession = (initialDocument: unknown) => {
  const [draft, setDraft] = useState(initialDocument);
  const [baseline, setBaseline] = useState(initialDocument);
  const [lastServerDraft, setLastServerDraft] = useState(initialDocument);
  const [incomingDraft, setIncomingDraft] = useState<unknown>();

  useEffect(() => {
    if (
      initialDocument === undefined ||
      initialDocument === lastServerDraft ||
      documentsEqual(initialDocument, lastServerDraft)
    ) {
      return;
    }
    setLastServerDraft(initialDocument);
    setBaseline(initialDocument);
    if (
      draft === undefined ||
      documentsEqual(draft, baseline) ||
      documentsEqual(draft, initialDocument)
    ) {
      setDraft(initialDocument);
      setIncomingDraft(undefined);
      return;
    }
    setIncomingDraft(initialDocument);
  }, [draft, baseline, initialDocument, lastServerDraft]);

  const markSaved = useCallback((document: unknown) => {
    setBaseline(document);
    setIncomingDraft((current: unknown) =>
      documentsEqual(current, document) ? undefined : current
    );
  }, []);
  const acceptRemote = useCallback(() => {
    if (incomingDraft === undefined) {
      return;
    }
    setDraft(incomingDraft);
    setBaseline(incomingDraft);
    setIncomingDraft(undefined);
  }, [incomingDraft]);
  const keepLocal = useCallback(() => {
    setIncomingDraft(undefined);
  }, []);
  return {
    draft,
    setDraft,
    markSaved,
    isDirty: !documentsEqual(draft, baseline),
    incomingDraft,
    hasRemoteUpdate: incomingDraft !== undefined && !documentsEqual(incomingDraft, draft),
    acceptRemote,
    keepLocal,
  };
};

export default useDraftSession;
