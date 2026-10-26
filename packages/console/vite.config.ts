import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import { findUp } from 'find-up';
import rehypeMdxCodeProps from 'rehype-mdx-code-props';
import remarkGfm from 'remark-gfm';
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';
import svgr from 'vite-plugin-svgr';

import { defaultConfig } from '../../vite.shared.config';

// We need to explicitly import the `.env` file and use `define` later because we do not have a
// prefix for our environment variables which it is required in Vite.
// @see {@link https://vitejs.dev/config/shared-options.html#envprefix}
dotenv.config({ path: await findUp('.env', {}) });

// The console is served by Logto core at `/console` in every mode, so it is always reached through
// core's origin. In cloud mode core also serves the cloud API the console calls, on that origin.
const buildConfig = (mode: string): UserConfig => ({
  base: `${process.env.CONSOLE_PUBLIC_URL ?? '/console'}`,
  envDir: '../../',
  server: {
    host: process.env.DEV_SERVER_HOST,
    port: 5002,
    hmr: {
      port: 6002,
    },
  },
  css: {
    modules: {
      generateScopedName: '__[hash:base64:5]__[local]',
    },
  },
  plugins: [
    {
      enforce: 'pre',
      ...mdx({
        providerImportSource: '@mdx-js/react',
        remarkPlugins: [remarkGfm],
        rehypePlugins: [[rehypeMdxCodeProps, { tagName: 'code' }]],
      }),
    },
    react(),
    svgr(),
    viteCompression({ disable: mode === 'development' }),
    viteCompression({ disable: mode === 'development', algorithm: 'brotliCompress' }),
  ],
  define: {
    'import.meta.env.IS_CLOUD': JSON.stringify(process.env.IS_CLOUD),
    'import.meta.env.PROTECTED_APP_LOCAL_DEV': JSON.stringify(process.env.PROTECTED_APP_LOCAL_DEV),
    'import.meta.env.ADMIN_ENDPOINT': JSON.stringify(process.env.ADMIN_ENDPOINT),
    'import.meta.env.DEV_FEATURES_ENABLED': JSON.stringify(process.env.DEV_FEATURES_ENABLED),
    'import.meta.env.INTEGRATION_TEST': JSON.stringify(process.env.INTEGRATION_TEST),
    'import.meta.env.CONSOLE_EMBEDDED_PRICING_URL': JSON.stringify(
      process.env.CONSOLE_EMBEDDED_PRICING_URL
    ),
    'import.meta.env.LOGTO_OSS_SURVEY_ENDPOINT': JSON.stringify(
      process.env.LOGTO_OSS_SURVEY_ENDPOINT
    ),
    // `@withtyped/client` needs this to be defined. We can optimize this later.
    'process.env': {},
  },
  build: {
    rollupOptions: {
      output: {
        // Tip: You can use `pnpx vite-bundle-visualizer` to analyze the bundle size
        // No manualChunks here on purpose. Hand-splitting node_modules made the chunk graph
        // cyclic, and a cycle evaluates in whichever order the build emits — the console then
        // blanks ("Class extends value undefined", "The superclass is not a constructor",
        // "Cannot set properties of undefined"), three times found on the Oct 2026 demo deploys
        // and patched package-by-package before that. Rollup's default placement is acyclic by
        // construction. Dynamic imports (locales, refractor, mermaid, ...) still get their own
        // chunks automatically. Revisit only with the emitted chunk graph verified acyclic.
        manualChunks: () => {
          // Intentionally no grouping - see the rationale above.
        },
      },
    },
  },
});

export default defineConfig(({ mode }) => mergeConfig(defaultConfig, buildConfig(mode)));
