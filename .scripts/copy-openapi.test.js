import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Core copies nested OpenAPI documents without an external rsync dependency', async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), 'openapi-copy-test-'));
  t.after(async () => rm(fixture, { recursive: true, force: true }));
  const source = join(fixture, 'routes');
  const target = join(fixture, 'output');
  await mkdir(join(source, 'nested'), { recursive: true });
  await mkdir(join(source, 'empty'), { recursive: true });
  await writeFile(join(source, 'one.openapi.json'), '{"paths":{}}');
  await writeFile(join(source, 'nested/two.openapi.json'), '{"tags":[]}');
  await writeFile(join(source, 'nested/private.test.ts'), 'not an API document');
  const manifest = JSON.parse(await readFile(new URL('../packages/core/package.json', import.meta.url), 'utf8'));
  assert.ok(!manifest.scripts['copy:apidocs'].includes('rsync'));
  execFileSync(process.execPath, [fileURLToPath(new URL('../packages/core/scripts/copy-apidocs.mjs', import.meta.url)), source, target]);
  assert.equal(await readFile(join(target, 'one.openapi.json'), 'utf8'), '{"paths":{}}');
  assert.equal(await readFile(join(target, 'nested/two.openapi.json'), 'utf8'), '{"tags":[]}');
  assert.deepEqual((await readdir(target)).sort(), ['nested', 'one.openapi.json']);
  assert.deepEqual(await readdir(join(target, 'nested')), ['two.openapi.json']);
});
