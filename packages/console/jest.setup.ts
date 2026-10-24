import { webcrypto } from 'node:crypto';
// eslint-disable-next-line n/prefer-global/text-encoder, n/prefer-global/text-decoder -- jsdom does not expose these globals, so the Node implementations are injected below.
import { TextEncoder, TextDecoder } from 'node:util';
import { runInThisContext } from 'node:vm';

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18next.use(initReactI18next).init({
  // Simple resources for testing
  resources: { en: { translation: { admin_console: { general: { add: 'Add' } } } } },
  lng: 'en',
  react: { useSuspense: false },
});

/* eslint-disable @silverhand/fp/no-mutation */
// @ts-expect-error monkey-patch for `crypto`
crypto.subtle = webcrypto.subtle;
// The Node and DOM `TextEncoder`/`TextDecoder` types no longer line up, so the globals are filled
// through the constructors' own types.
/* eslint-disable no-restricted-syntax -- The Node and DOM types for these constructors no longer match, and the assignment is the point of the polyfill. */
global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder;
/* eslint-enable no-restricted-syntax */
/* eslint-enable @silverhand/fp/no-mutation */

// Node's `Request` (used by React Router's client requests) checks `instanceof AbortSignal` against
// the main-context class, but Jest's jsdom sandbox has its own `AbortController`/`AbortSignal`, so
// signals from the sandbox are rejected. Use the main-context classes so both sides agree.
/* eslint-disable @silverhand/fp/no-mutation, @typescript-eslint/no-unsafe-assignment -- Test-only global override so signals share one realm; `runInThisContext` is typed `any` by Node. */
global.AbortController = runInThisContext('AbortController');
global.AbortSignal = runInThisContext('AbortSignal');
/* eslint-enable @silverhand/fp/no-mutation, @typescript-eslint/no-unsafe-assignment */
