import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { versionLandingCms } from '../../../../scripts/version-landing-cms';

it('emits a content-hashed renderer URL so caches cannot reuse an older cms.js response', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'landing-cms-assets-'));
  const source = 'window.heroIntro = "XXXXXXXX";';
  await writeFile(path.join(directory, 'cms.js'), source);
  await writeFile(
    path.join(directory, 'index.html'),
    '<script src="/console/landing/cms.js?v=old" defer></script>'
  );
  const asset = await versionLandingCms(directory);
  expect(asset).toMatch(/^cms\.[\da-f]{12}\.js$/);
  expect(await readFile(path.join(directory, asset), 'utf8')).toBe(source);
  expect(await readFile(path.join(directory, 'index.html'), 'utf8')).toBe(
    `<script src="/console/landing/${asset}" defer></script>`
  );
  expect(await versionLandingCms(directory)).toBe(asset);
  await writeFile(path.join(directory, 'cms.js'), 'window.heroIntro = "new";');
  const changed = await versionLandingCms(directory);
  expect(changed).not.toBe(asset);
  expect(await readFile(path.join(directory, 'index.html'), 'utf8')).toContain(changed);
});
