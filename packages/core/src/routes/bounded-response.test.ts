import { createResponseBudget, readBoundedResponse } from './bounded-response.js';

const { jest } = import.meta;
it('preserves complete UTF-8 across chunks at an exact byte ceiling', async () => {
  const bytes = new TextEncoder().encode('aé');
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    })
  );
  await expect(readBoundedResponse(response, { maxBytes: 3 })).resolves.toBe('aé');
});

it('cancels a stalled stream on caller cancellation without waiting for another chunk', async () => {
  const cancel = jest.fn();
  const abort = new AbortController();
  const response = new Response(new ReadableStream({ cancel }));
  const read = readBoundedResponse(response, { maxBytes: 100, signal: abort.signal });
  abort.abort();
  await expect(read).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('cancels a stalled stream at deadline', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, 100);
  try {
    const read = readBoundedResponse(new Response(new ReadableStream({ cancel })), {
      maxBytes: 100,
      signal: abort.signal,
    });
    const rejection = expect(read).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(100);
    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
  } finally {
    clearTimeout(timer);
    jest.useRealTimers();
  }
});

it('shares the aggregate budget across concurrent readers and aborts overflow', async () => {
  const abort = jest.fn();
  const consume = createResponseBudget(5, abort);
  const results = await Promise.allSettled(
    [new Response('abc'), new Response('def')].map(async (response) =>
      readBoundedResponse(response, { maxBytes: 5, consume })
    )
  );
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  expect(abort).toHaveBeenCalledTimes(1);
});
