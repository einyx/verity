/** @jest-environment node */
import ky, { TimeoutError } from 'ky';

import { createSessionApi } from './session-api';

it('uses a fresh separate Cloud credential on explicit Save without replaying the request', async () => {
  const landingHeaders = jest
    .fn()
    .mockResolvedValueOnce({ 'x-landing-page-authorization': 'Bearer fresh-cloud-token' });
  const fetcher = jest.fn(async (input: RequestInfo | URL) => {
    const request = new Request(input);
    expect(request.url).toBe('https://console.test/api/ai-chat/actions/review/confirm');
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toBe('Bearer tenant-token');
    expect(request.headers.get('x-landing-page-authorization')).toBe('Bearer fresh-cloud-token');
    return new Response(JSON.stringify({ executed: true }));
  });
  const api = createSessionApi(
    ky.create({
      prefixUrl: 'https://console.test',
      fetch: fetcher,
      headers: { authorization: 'Bearer tenant-token' },
    }),
    landingHeaders
  );
  await api.confirm('review');
  expect(landingHeaders).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('turn requests use the long timeout without automatic transport replay', async () => {
  const fetcher = jest.fn(async (input: RequestInfo | URL) => {
    const request = new Request(input);
    expect(request.url).toBe('https://console.test/api/ai-chat/sessions/one/turns');
    expect(request.headers.get('x-landing-page-authorization')).toBe('synthetic');
    return new Response(
      JSON.stringify({
        id: 'turn',
        requestId: '00000000-0000-4000-8000-000000000001',
        state: 'completed',
        errorCode: null,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        completedAt: null,
        messageIds: [],
      })
    );
  });
  const api = createSessionApi(
    ky.create({ prefixUrl: 'https://console.test', fetch: fetcher }),
    async () => ({ 'x-landing-page-authorization': 'synthetic' })
  );
  const result = await api.turn('one', {
    requestId: '00000000-0000-4000-8000-000000000001',
    expectedTranscriptRevision: 0,
    composerRevision: 0,
    text: 'hello',
    attachments: [],
  });
  expect(result.state).toBe('completed');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('typed CAS errors remain actionable and do not include draft contents', async () => {
  const api = createSessionApi(
    ky.create({
      prefixUrl: 'https://console.test',
      fetch: async () =>
        new Response(JSON.stringify({ error: 'revision_conflict', currentRevision: 4 }), {
          status: 409,
        }),
    }),
    async () => ({})
  );
  await expect(
    api.saveComposer('one', { expectedRevision: 0, text: 'private draft', attachments: [] })
  ).rejects.toMatchObject({ code: 'revision_conflict', currentRevision: 4 });
});

it('a slow turn survives the ordinary request budget and times out at the bounded three-minute budget without replay', async () => {
  jest.useFakeTimers();
  try {
    const fetcher = jest.fn(
      async () =>
        new Promise<Response>(() => {
          /* Simulate a transport that never produces a response. */
        })
    );
    const failure = jest.fn();
    const api = createSessionApi(
      ky.create({ prefixUrl: 'https://console.test', fetch: fetcher }),
      async () => ({})
    );
    const completion = (async () => {
      try {
        await api.turn('one', {
          requestId: '00000000-0000-4000-8000-000000000001',
          expectedTranscriptRevision: 0,
          composerRevision: 0,
          text: 'synthetic',
          attachments: [],
        });
      } catch (error) {
        failure(error);
      }
    })();
    await jest.advanceTimersByTimeAsync(20_001);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(failure).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(160_000);
    await completion;
    expect(failure).toHaveBeenCalledWith(expect.any(TimeoutError));
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
