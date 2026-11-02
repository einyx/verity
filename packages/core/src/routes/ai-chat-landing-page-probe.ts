import RequestError from '#src/errors/RequestError/index.js';
import { createCloudApiFetch, getCloudTransport } from '#src/libraries/cloud-transport.js';

const readMetadata = async (response: Response) => {
  const metadata = {
    editorStatus: response.status,
    editorApplicationJson:
      response.headers.get('content-type')?.includes('application/json') ?? false,
    editorChallenge: response.headers.get('cf-mitigated') === 'challenge',
  };
  await response.body?.cancel();
  return metadata;
};

/** Explicit diagnostic only, never a generation retry/fallback; return no document or credentials. */
const comparePublicEditor = async (canonical: URL, token: string) => {
  try {
    const result = await readMetadata(
      await fetch(canonical, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
    );
    return {
      publicEditorStatus: result.editorStatus,
      publicEditorApplicationJson: result.editorApplicationJson,
      publicEditorChallenge: result.editorChallenge,
    };
  } catch {
    return { publicEditorStatus: 0, publicEditorTransportFailed: true };
  }
};

/** Explicit diagnostic GET only. Cancel the page body: expose no document, identity or credential. */
export const probeLandingPageEditor = async (
  apiBase: string,
  getToken: () => Promise<string>,
  comparePublic = false
) => {
  try {
    const token = await getToken();
    const canonical = new URL(`${apiBase.replace(/\/$/, '')}/landing-page/editor`);
    const transport = getCloudTransport(canonical.href);
    const response = await createCloudApiFetch()(canonical, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const metadata = await readMetadata(response);
    const editorUsesInternalTransport = new URL(transport.endpoint).origin !== canonical.origin;
    const comparison =
      comparePublic && editorUsesInternalTransport
        ? await comparePublicEditor(canonical, token)
        : {};
    return { ...metadata, editorUsesInternalTransport, ...comparison };
  } catch (error) {
    if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
      return { editorStatus: error.status, editorCredentialRejected: true };
    }
    return { editorStatus: 0, editorTransportFailed: true };
  }
};
