import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// Inspect the emitted artifact, not source or the presence of tree-shaken components.
// Missing/changed emitter shapes fail closed and require a reviewed verifier update.
export function verifyCloudConsole(bundle) {
  const flag = (name) => {
    const expression = bundle.match(new RegExp(`${name}=([^;]+?)\\|\\|yes\\(localStorage`))?.[1];
    const cloudExpression = bundle.match(/isCloud=(yes\(normalizeEnv\([^)]*\)\))/)?.[1];
    const emitted = name === 'isCloud' ? cloudExpression : expression;
    assert.ok(emitted, `Cannot identify emitted ${name}`);
    return runInNewContext(emitted, {
      normalizeEnv: (value) => value == null ? undefined : String(value),
      yes: (value) => ['1', 'true', 'yes'].includes(String(value).toLowerCase()),
    }, { timeout: 1000 });
  };
  assert.equal(flag('isCloud'), true, 'Cloud build must default to enabled');
  assert.equal(flag('isDevFeaturesEnabled'), true,
    'Production artifact defaults to LegacyAiChat: build with dev_features_enabled=1');
  assert.match(bundle, /function AiChat\([^)]*\)\{return isDevFeaturesEnabled\?[\w$.]+\(AccountAiChat,/,
    'Enabled production branch must select AccountAiChat');
  assert.match(bundle, /Conversation history/);
  assert.match(bundle, /New chat/);
  assert.match(bundle, /CmsPreviewSuggestion/);
  return { cloud: true, devFeatures: true, defaultAi: 'AccountAiChat', localOverride: false };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  console.log(JSON.stringify(verifyCloudConsole(readFileSync(process.argv[2], 'utf8'))));
}
