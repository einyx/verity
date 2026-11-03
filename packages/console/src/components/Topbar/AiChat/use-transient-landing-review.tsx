import { landingPageDocumentGuard } from '@logto/schemas';
import { useEffect, useRef, useState } from 'react';

import useApi from '@/hooks/use-api';

import TransientLandingReview, { type TransientPreview } from './TransientLandingReview';
import useLandingPageAiHeaders from './use-landing-page-ai-headers';

const failureText = {
  authentication_required: 'Your landing-page credential is missing or expired. Refresh your session; editing rights have not been determined.',
  forbidden: 'Your verified credential does not authorize landing-page review. No page or Save proposal was changed.',
  unavailable: 'Landing-page review is temporarily unavailable. Your input and existing drafts are unchanged.',
};

/** Preview payloads live only here: never in message metadata, storage, session history or reviews. */
export default function useTransientLandingReview() {
  const api = useApi();
  const headers = useLandingPageAiHeaders();
  const [preview, setPreview] = useState<TransientPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const discard = () => {
    epoch.current += 1;
    setPreview(undefined);
    setError(undefined);
    setBusy(false);
  };
  useEffect(() => () => { epoch.current += 1; }, []);
  useEffect(() => {
    if (!preview) { return; }
    const timer = setTimeout(() => { setPreview(undefined); }, Math.max(0, Date.parse(preview.expiresAt) - Date.now()));
    return () => { clearTimeout(timer); };
  }, [preview]);
  const review = async (instruction: string) => {
    const request = ++epoch.current;
    setBusy(true);
    setError(undefined);
    // Preserve a previous transient preview if a new request fails.
    try {
      const authorization = await headers();
      const capability = await api.get('api/ai-chat/landing-page-capabilities', { headers: authorization }).json<{ canReview: boolean; state: keyof typeof failureText | 'authorized' }>();
      if (!capability.canReview) {
        if (request === epoch.current) { setError(failureText[capability.state === 'authorized' ? 'unavailable' : capability.state]); }
        return;
      }
      const response = await api.post('api/ai-chat/landing-page-review', { headers: authorization, json: { instruction }, timeout: 180_000 }).json<TransientPreview>();
      const draft = landingPageDocumentGuard.parse(response.draft);
      if (!Number.isFinite(Date.parse(response.expiresAt))) { throw new Error('invalid expiry'); }
      if (request === epoch.current) { setPreview({ draft, expiresAt: response.expiresAt }); }
    } catch (cause) {
      const status = typeof cause === 'object' && cause !== null && 'response' in cause && cause.response instanceof Response ? cause.response.status : 503;
      if (request === epoch.current) { setError(failureText[status === 401 ? 'authentication_required' : status === 403 ? 'forbidden' : 'unavailable']); }
    } finally {
      if (request === epoch.current) { setBusy(false); }
    }
  };
  return {
    review,
    busy,
    panel: <>{busy && <p role="status">Reviewing the landing page without saving…</p>}{error && <p role="alert">{error}</p>}{preview && <TransientLandingReview preview={preview} onDiscard={discard} />}</>,
  };
}
