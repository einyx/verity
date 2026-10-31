import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/codeql-analysis.yml', import.meta.url),
  'utf8',
);

test('CodeQL stages use the supported Node 24 action generation', () => {
  const actions = [...workflow.matchAll(/uses:\s*github\/codeql-action\/([\w-]+)@(\S+)/g)];
  assert.deepEqual(actions.map(([, action]) => action), ['init', 'autobuild', 'analyze']);
  for (const [, action, version] of actions) {
    assert.equal(version, 'v4', `${action} must use CodeQL Action v4`);
  }
  assert.match(workflow, /uses:\s*actions\/checkout@v5\b/);
});

test('CodeQL uses an explicit supported Ubuntu image rather than a migrating label', () => {
  assert.match(workflow, /runs-on:\s*ubuntu-24\.04\b/);
  assert.doesNotMatch(workflow, /runs-on:\s*ubuntu-latest\b/);
});
