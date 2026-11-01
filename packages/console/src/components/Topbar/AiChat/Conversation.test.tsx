import { runInThisContext } from 'node:vm';

import { type ChatModelAdapter } from '@assistant-ui/react';
import { render } from '@testing-library/react';
import ky from 'ky';
import { type ReactNode } from 'react';

import Conversation from './Conversation';

const mockFetch = jest.fn<Promise<Response>, [Request]>();
const mockRuntime = jest.fn();
const mockReviews = jest.fn();
const mockApi = ky.create({
  prefixUrl: 'http://synthetic.invalid/',
  timeout: 20_000,
  headers: { Authorization: 'Bearer synthetic-management-token' },
  fetch: async (request) => mockFetch((request as Request).clone()),
});
jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: () => mockApi }));
const mockHeaders = async () => ({
  'x-landing-page-authorization': 'Bearer synthetic-cloud-token',
});
jest.mock('./use-landing-page-ai-headers', () => ({
  __esModule: true,
  default: () => mockHeaders,
}));
jest.mock('./use-chat-action-reviews', () => ({
  __esModule: true,
  default: (options: unknown) => {
    mockReviews(options);
  },
}));
jest.mock('@/cloud/hooks/use-landing-page', () => ({ landingPageEditorKey: 'synthetic-editor' }));
jest.mock('@assistant-ui/react', () => ({
  AssistantRuntimeProvider: ({ children }: { readonly children: ReactNode }) => (
    <div>{children}</div>
  ),
  useLocalRuntime: (adapter: ChatModelAdapter) => mockRuntime(adapter),
  useAui: () => ({}),
}));

beforeAll(() => {
  for (const name of ['Request', 'Response', 'Headers']) {
    Reflect.set(globalThis, name, runInThisContext(name));
  }
});

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  mockRuntime.mockClear();
  mockReviews.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

const startCompletion = () => {
  const onRunStateChange = jest.fn();
  render(
    <Conversation onReady={jest.fn()} onRunStateChange={onRunStateChange}>
      {null}
    </Conversation>
  );
  const adapter = mockRuntime.mock.lastCall?.[0] as ChatModelAdapter;
  const result = adapter.run({
    messages: [
      {
        id: 'synthetic-message',
        createdAt: new Date(),
        role: 'user',
        content: [{ type: 'text', text: 'Review this synthetic hero' }],
        attachments: [],
        metadata: { custom: {} },
      },
    ],
    runConfig: {},
    context: {},
    unstable_getMessage: () => {
      throw new Error('The completion adapter must not access runtime internals');
    },
    abortSignal: new AbortController().signal,
  });
  return { result, onRunStateChange };
};

it('keeps loading past the ordinary 20s timeout and returns the 37s completion once', async () => {
  mockFetch.mockImplementation(
    async () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(Response.json({ content: 'Synthetic hero review' }));
        }, 37_000);
      })
  );
  const { result, onRunStateChange } = startCompletion();
  const completed = expect(result).resolves.toMatchObject({
    content: [{ type: 'text', text: 'Synthetic hero review' }],
  });
  await jest.advanceTimersByTimeAsync(20_001);
  expect(onRunStateChange.mock.calls).toEqual([[true]]);
  await jest.advanceTimersByTimeAsync(16_999);
  await completed;
  expect(onRunStateChange.mock.calls).toEqual([[true], [false]]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const request = mockFetch.mock.calls[0]?.[0];
  expect(request?.headers.get('Authorization')).toBe('Bearer synthetic-management-token');
  expect(request?.headers.get('x-landing-page-authorization')).toBe('Bearer synthetic-cloud-token');
  await expect(request?.json()).resolves.toEqual({
    messages: [{ role: 'user', content: 'Review this synthetic hero' }],
  });
});

it('bounds a stalled completion at 180s, clears loading and never retries', async () => {
  mockFetch.mockImplementation(
    async () =>
      new Promise(() => {
        /* Intentionally stalled transport. */
      })
  );
  const { result, onRunStateChange } = startCompletion();
  const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await jest.advanceTimersByTimeAsync(179_999);
  expect(onRunStateChange.mock.calls).toEqual([[true]]);
  await jest.advanceTimersByTimeAsync(1);
  await rejected;
  expect(onRunStateChange.mock.calls).toEqual([[true], [false]]);
  await jest.advanceTimersByTimeAsync(180_000);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it.each(['confirm', 'cancel'])(
  'keeps %s at the ordinary 20s timeout without retries',
  async (operation) => {
    mockFetch.mockImplementation(
      async () =>
        new Promise(() => {
          /* Intentionally stalled transport. */
        })
    );
    render(
      <Conversation onReady={jest.fn()} onRunStateChange={jest.fn()}>
        {null}
      </Conversation>
    );
    const reviews = mockReviews.mock.lastCall?.[0] as Record<
      string,
      (id: string) => Promise<unknown>
    >;
    const rejected = expect(reviews[operation]?.('synthetic-action')).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await jest.advanceTimersByTimeAsync(20_000);
    await rejected;
    await jest.advanceTimersByTimeAsync(180_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  }
);
