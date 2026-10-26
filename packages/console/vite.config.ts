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
        manualChunks: (id) => {
          // Keep every node_modules package in one chunk. Splitting react from the other deps
          // makes the chunk graph cyclic (a deps chunk imports a deps chunk that imports react),
          // and a cycle evaluates in whichever order the build happens to emit - the console
          // then blanks with "The superclass is not a constructor" (found on the Oct 2026 demo
          // deploy). Re-split only after verifying the emitted chunk graph is acyclic.
          if (/\/node_modules\/(cose-base|layout-base|cytoscape|cytoscape-[^/]*)\//.test(id)) {
            return 'cytoscape';
          }

          if (id.includes('/@logto/')) {
            return '@logto';
          }

          if (id.includes('/node_modules/')) {
            // Large lazy libraries keep their own chunks for caching; none of them import
            // react, so these edges stay one-directional and cannot cycle.
            for (const largePackage of [
              'libphonenumber-js',
              'mermaid',
              'elkjs',
              'katex',
              'refractor',
              'lodash',
              'lodash-es',
            ]) {
              if (id.includes(`/node_modules/${largePackage}/`)) {
                return largePackage;
              }
            }

            return 'vendors';
          }

          const match = /\/lib\/locales\/([^/]+)/.exec(id);
          if (match?.[1]) {
            return `phrases-${match[1]}`;
          }
        },
      },
    },
  },
});

export default defineConfig(({ mode }) => mergeConfig(defaultConfig, buildConfig(mode)));
