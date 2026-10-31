import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const temporary = mkdtempSync(join(tmpdir(), 'prepare-cloud-'));
after(() => rmSync(temporary, { recursive: true, force: true }));
const repository = join(temporary, 'repository');
mkdirSync(repository);
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
git('init', '--quiet');
writeFileSync(join(repository, 'package.json'), JSON.stringify({ name: '@meshx/cloud' }));
writeFileSync(join(repository, 'LICENSE'), 'Existing license notice');
git('add', '.');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture');
const revision = git('rev-parse', 'HEAD');
const rootFor = (name) => {
  const root = join(temporary, name);
  mkdirSync(join(root, 'packages/core'), { recursive: true });
  writeFileSync(join(root, 'packages/core/package.json'), JSON.stringify({ dependencies: { public: '1.0.0' } }));
  return root;
};

// Dynamic import makes the absent implementation an explicit failed assertion in the first RED run.
test('the build preparation implementation exists', async () => {
  assert.ok(existsSync(new URL('./prepare-cloud-plugin.mjs', import.meta.url)));
});

test('OSS opt-out requires neither a revision, repository access nor credentials', async () => {
  const { prepareCloudPlugin } = await import('./prepare-cloud-plugin.mjs');
  const root = rootFor('oss');
  assert.equal(prepareCloudPlugin({ root, includeCloud: '0' }), false);
  assert.equal(existsSync(join(root, 'packages/cloud')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'packages/core/package.json'))).dependencies, { public: '1.0.0' });
});

test('rejects invalid inclusion switches and mutable revisions', async () => {
  const { prepareCloudPlugin } = await import('./prepare-cloud-plugin.mjs');
  const root = rootFor('invalid');
  assert.throws(() => prepareCloudPlugin({ root, includeCloud: 'maybe' }), /include_cloud/);
  assert.throws(() => prepareCloudPlugin({ root, revision: 'main', repository }), /full commit SHA/);
});

test('requires repository credentials by default before attempting a network checkout', async () => {
  const { prepareCloudPlugin } = await import('./prepare-cloud-plugin.mjs');
  assert.throws(() => prepareCloudPlugin({ root: rootFor('unauthorized'), revision, tokenFile: join(temporary, 'missing-token') }), /cloud_github_token/);
});

test('includes exactly the pinned tree and wires the build-local workspace without Git metadata', async () => {
  const { prepareCloudPlugin } = await import('./prepare-cloud-plugin.mjs');
  const root = rootFor('included');
  assert.equal(prepareCloudPlugin({ root, revision, repository }), true);
  assert.equal(readFileSync(join(root, 'packages/cloud/LICENSE'), 'utf8'), 'Existing license notice');
  assert.equal(existsSync(join(root, 'packages/cloud/.git')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'packages/core/package.json'))).dependencies, { public: '1.0.0', '@meshx/cloud': 'workspace:^' });
});

test('never replaces an existing cloud directory, including an opted-out build context', async () => {
  const { prepareCloudPlugin } = await import('./prepare-cloud-plugin.mjs');
  const root = rootFor('existing');
  mkdirSync(join(root, 'packages/cloud'));
  writeFileSync(join(root, 'packages/cloud/keep'), 'user work');
  for (const includeCloud of ['1', '0']) {
    assert.throws(() => prepareCloudPlugin({ root, includeCloud, revision, repository }), /already exists/);
  }
  assert.equal(readFileSync(join(root, 'packages/cloud/keep'), 'utf8'), 'user work');
});

test('a checkout failure leaves the manifest and destination untouched', async () => {
  const { prepareCloudPlugin } = await import('./prepare-cloud-plugin.mjs');
  const root = rootFor('failed');
  assert.throws(() => prepareCloudPlugin({ root, revision: '0'.repeat(40), repository }), /checkout/);
  assert.equal(existsSync(join(root, 'packages/cloud')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'packages/core/package.json'))).dependencies, { public: '1.0.0' });
});
