import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Public landing HTML is copied, not bundled by Vite. Give its renderer a real immutable URL too. */
export const versionLandingCms = async (directory: string): Promise<string> => {
  const [renderer, html] = await Promise.all([
    readFile(path.join(directory, 'cms.js')),
    readFile(path.join(directory, 'index.html'), 'utf8'),
  ]);
  const asset = `cms.${createHash('sha256').update(renderer).digest('hex').slice(0, 12)}.js`;
  const versioned = html.replaceAll(
    /(src=["']\/console\/landing\/)cms(?:\.[\da-f]{12})?\.js(?:\?[^"']*)?(["'])/g,
    `$1${asset}$2`
  );
  if (!versioned.includes(`/console/landing/${asset}`)) {
    throw new Error('Landing HTML does not reference the CMS renderer.');
  }
  // Write the new file before pointing HTML at it; keep cms.js for existing clients.
  await writeFile(path.join(directory, asset), renderer);
  await writeFile(path.join(directory, 'index.html'), versioned);
  return asset;
};
