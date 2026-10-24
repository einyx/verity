import { type SsrData } from '@logto/schemas';
import type { JSX as ReactJsx } from 'react';

type LogtoNativeSdkInfo = {
  platform: 'ios' | 'android';
  callbackLink: string;
  getPostMessage: () => (data: { callbackUri?: string; redirectTo?: string }) => void;
  supportedConnector: {
    universal: boolean;
    nativeTargets: string[];
  };
};

type LogtoSsr = string | Readonly<SsrData> | undefined;

type CapWidgetAttributes = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  // React 18 passes `class` (not `className`) through to custom elements
  class?: string;
  'data-cap-api-endpoint': string;
  'data-cap-lang'?: string;
};

// React 19 reads its intrinsic element map from the `react` module, not the global JSX namespace.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'cap-widget': CapWidgetAttributes;
    }
  }
}

declare global {
  const logtoNativeSdk: LogtoNativeSdkInfo | undefined;
  const logtoSsr: LogtoSsr;

  namespace JSX {
    interface IntrinsicElements extends ReactJsx.IntrinsicElements {
      'cap-widget': CapWidgetAttributes;
    }
  }

  interface Window {
    logtoNativeSdk: LogtoNativeSdkInfo | undefined;
    logtoSsr: LogtoSsr;

    // Captcha providers
    grecaptcha?: {
      enterprise: {
        ready: (callback: () => void) => void;
        execute: (sitekey: string, options: { action: string }) => Promise<string>;
        render: (
          element: HTMLElement,
          options: {
            sitekey: string;
            callback: (token: string) => void;
            theme?: 'light' | 'dark';
            'error-callback'?: (errorCode?: string) => void;
          }
        ) => number;
      };
    };
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          theme: 'light' | 'dark';
          'error-callback': (errorCode: string) => void;
          size: string;
        }
      ) => void;
    };
  }
}
