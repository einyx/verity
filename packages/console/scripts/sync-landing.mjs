// Keeps the static landing page in step with its build. Stamps each landing asset's version from the
// file's content, so a changed file is never served from a stale browser cache. Assets are stamped in
// dependency order: the chat app first (referenced by demo-chat.js), then the files that reference them.
// With `--copy`, also mirrors `public/landing` into `dist/landing`, which Logto core serves in
// preference to `public/landing`. `vite build` already copies it, so `build` only needs the stamp.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public/landing');
const target = path.join(root, 'dist/landing');

// Files that reference the assets, and the assets in the order they must be stamped.
const referencing = ['index.html', 'demo-chat.js', 'landing-elements.js'];
const assets = [
  'demo-chat-app.js',
  'demo-chat.css',
  'demo-chat.js',
  'landing-renderer.js',
  'landing-elements.css',
  'landing-elements.js',
  'cms.js',
];

const stampAsset = async (asset) => {
  const hash = createHash('sha256')
    .update(await readFile(path.join(source, asset)))
    .digest('hex')
    .slice(0, 10);
  const pattern = new RegExp(`(/console/landing/${asset.replace(/\./g, '\\.')})(\\?v=[^"']*)?(["'])`, 'g');
  let found = 0;

  for (const file of referencing) {
    const filePath = path.join(source, file);
    const content = await readFile(filePath, 'utf8');
    const updated = content.replace(pattern, (_, base, _query, quote) => {
      found += 1;
      return `${base}?v=${hash}${quote}`;
    });

    if (updated !== content) {
      await writeFile(filePath, updated);
    }
  }

  if (found === 0) {
    throw new Error(`No landing file references ${asset}`);
  }
};

for (const asset of assets) {
  // eslint-disable-next-line no-await-in-loop -- each stamp rewrites files the next one hashes.
  await stampAsset(asset);
}

if (process.argv.includes('--copy')) {
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
}
