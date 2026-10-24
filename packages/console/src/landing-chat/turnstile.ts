// Cloudflare Turnstile for the landing-page chat. The widget renders in explicit mode, so the chat decides
// when to draw it. Each token is single-use, so the chat resets the widget after every send to have a fresh
// token ready for the next new session.

const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    }
  ) => string;
  reset: (widgetId: string) => void;
};

const isTurnstileApi = (value: unknown): value is TurnstileApi =>
  typeof value === 'object' &&
  value !== null &&
  'render' in value &&
  typeof value.render === 'function' &&
  'reset' in value &&
  typeof value.reset === 'function';

/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- the script loads once per page, and the cached promise is that single load. */
let loading: Promise<TurnstileApi> | undefined;

/** Adds the Turnstile script once, and resolves with its API when it has loaded. */
const loadTurnstile = async (): Promise<TurnstileApi> => {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.addEventListener('load', () => {
      const api: unknown = Reflect.get(window, 'turnstile');

      if (isTurnstileApi(api)) {
        resolve(api);
      } else {
        reject(new Error('Turnstile did not load.'));
      }
    });
    script.addEventListener('error', () => {
      reject(new Error('Turnstile could not be reached.'));
    });
    document.head.append(script);
  });

  return loading;
};
/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */

const delayMs = 100;

/** Reads a value now, and again every 100 ms until it is set or the time runs out. */
const poll = async <T>(read: () => T | undefined, attemptsLeft: number): Promise<T | undefined> => {
  const value = read();

  if (value !== undefined || attemptsLeft <= 0) {
    return value;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

  return poll(read, attemptsLeft - 1);
};

/** Waits up to timeoutMs for the value to be set. Resolves with undefined when it is not set in time. */
export const readWithin = async <T>(read: () => T | undefined, timeoutMs: number) =>
  poll(read, Math.ceil(timeoutMs / delayMs));

/**
 * Draws the widget in the container. Each new token, and each expiry or error, is passed to onToken, which
 * gets undefined when no token is available. Resolves with a function that resets the widget.
 */
export const renderTurnstile = async (
  container: HTMLElement,
  siteKey: string,
  onToken: (token?: string) => void
): Promise<() => void> => {
  const api = await loadTurnstile();
  const widgetId = api.render(container, {
    sitekey: siteKey,
    appearance: 'interaction-only',
    callback: (token) => {
      onToken(token);
    },
    'expired-callback': () => {
      onToken();
    },
    'error-callback': () => {
      onToken();
    },
  });

  // The widget can lose its frame while the dialog is closed or moved, and reset then fails. In that case
  // draw a fresh widget in the same container so the next send still gets a token.
  const redraw = async () => {
    try {
      await renderTurnstile(container, siteKey, onToken);
    } catch {
      onToken();
    }
  };

  return () => {
    try {
      if (!container.querySelector('iframe')) {
        throw new Error('Turnstile frame is missing.');
      }
      api.reset(widgetId);
    } catch {
      container.replaceChildren();
      void redraw();
    }
  };
};
