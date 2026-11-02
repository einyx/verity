import { act, renderHook } from '@testing-library/react';

import useTextHandler from './use-text-handler';

const setToast = jest.fn();

jest.mock('./use-toast', () => ({
  __esModule: true,
  default: () => ({ setToast }),
}));

describe('backup-code text actions (synthetic content only)', () => {
  const content = 'DEMO-ONLY-0001\nDEMO-ONLY-0002';
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const objectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    for (const [target, key, descriptor] of [
      [navigator, 'clipboard', clipboardDescriptor],
      [URL, 'createObjectURL', objectUrlDescriptor],
    ] as const) {
      if (descriptor) {
        // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- restore only the test-owned browser stub
        Object.defineProperty(target, key, descriptor);
      } else {
        Reflect.deleteProperty(target, key);
      }
    }
  });

  it('copies the exact newline-separated content without touching the real clipboard', async () => {
    const writeText = jest.fn(async () => {
      // Synthetic clipboard: deliberately performs no browser clipboard access.
    });
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- install a synthetic clipboard, restored after the test
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(useTextHandler);

    await act(async () => {
      await result.current.copyText(content, 'Synthetic copy complete');
    });

    expect(writeText).toHaveBeenCalledWith(content);
    expect(setToast).toHaveBeenCalledWith('Synthetic copy complete');
  });

  it('downloads the same plain-text content and filename without starting a download', async () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:synthetic-backup-codes');
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- install a synthetic object URL factory, restored after the test
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      // Prevent navigation or a real download in the test environment.
    });
    const { result } = renderHook(useTextHandler);

    act(() => {
      result.current.downloadText(content, 'backup_code.txt');
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('text/plain');
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        resolve(reader.result);
      });
      // eslint-disable-next-line unicorn/prefer-blob-reading-methods -- Jest's jsdom Blob does not implement text()
      reader.readAsText(blob);
    });
    expect(text).toBe(content);
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toEqual(
      expect.objectContaining({
        download: 'backup_code.txt',
        href: 'blob:synthetic-backup-codes',
      })
    );
  });
});
