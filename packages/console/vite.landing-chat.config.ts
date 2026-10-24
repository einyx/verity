import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the landing page demo chat into `public/landing` as one classic script, so the static page
// loads it with a plain `<script>` tag and no module loader. Run with `pnpm build:landing-chat`.
export default defineConfig({
  plugins: [react()],
  // `public/` is the landing site itself, so it must not be copied into the output folder.
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'public/landing',
    // The landing folder also holds the static site, so the build must not clear it.
    emptyOutDir: false,
    lib: {
      entry: 'src/landing-chat/index.tsx',
      name: 'MeshxDemoChat',
      formats: ['iife'],
      fileName: () => 'demo-chat-app.js',
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: 'demo-chat-app[extname]',
      },
    },
  },
});
