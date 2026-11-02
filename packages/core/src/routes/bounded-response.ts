/** A shared run budget is charged synchronously before retaining each decoded transport chunk. */
export const createResponseBudget = (maxBytes: number, abort: () => void) => {
  // eslint-disable-next-line @silverhand/fp/no-let -- Shared by concurrent page readers.
  let remaining = maxBytes;
  return (bytes: number) => {
    if (bytes > remaining) {
      abort();
      throw new Error('Response budget exceeded');
    }
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Charge before retaining bytes.
    remaining -= bytes;
  };
};

/** Bounds bytes BEFORE UTF-8 decoding/JSON parsing. Fetch and Got expose decompressed chunks. */
export const readBoundedResponse = async (
  response: Response,
  {
    maxBytes,
    signal,
    consume,
  }: {
    maxBytes: number;
    signal?: AbortSignal;
    consume?: (bytes: number) => void;
  }
): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line @silverhand/fp/no-let -- Streaming per-response byte count.
  let size = 0;
  const cancel = () => {
    // eslint-disable-next-line promise/prefer-await-to-then -- Abort event handlers cannot await; reader.read observes cancellation below.
    void reader.cancel().catch(() => null);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    // eslint-disable-next-line no-constant-condition, @typescript-eslint/no-unnecessary-condition -- Ordered bounded stream.
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- Preserve chunk order.
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        break;
      }
      consume?.(value.byteLength);
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Count bytes, not JS characters.
      size += value.byteLength;
      if (size > maxBytes) {
        throw new Error('Response too large');
      }
      // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Bounded local accumulator.
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    await reader.cancel().catch(() => null);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
};
