import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyCloudConsole } from './verify-cloud-console.mjs';

const artifact = (dev, cloud = '1') => `isCloud=yes(normalizeEnv("${cloud}")),isDevFeaturesEnabled=yes(normalizeEnv("${dev}"))||yes(localStorage.getItem(storageKeys.isDevFeaturesEnabled));function AiChat(p){return isDevFeaturesEnabled?jsx(AccountAiChat,p):jsx(LegacyAiChat,p)} Conversation history New chat CmsPreviewSuggestion`;
test('rejects omitted feature flag even when both AI components are bundled', () => {
  assert.throws(() => verifyCloudConsole(artifact('')), /defaults to LegacyAiChat/);
});
test('rejects OSS output and unrecognized emitter shapes', () => {
  assert.throws(() => verifyCloudConsole(artifact('1', '')), /Cloud build/);
  assert.throws(() => verifyCloudConsole('AccountAiChat LegacyAiChat'), /Cannot identify/);
});
test('accepts explicit Cloud and rich-workspace defaults without storage access', () => {
  assert.equal(verifyCloudConsole(artifact('1')).defaultAi, 'AccountAiChat');
});
test('rejects an inverted selector even with both components and enabled flags', () => {
  const inverted = artifact('1').replace('jsx(AccountAiChat,p):jsx(LegacyAiChat,p)',
    'jsx(LegacyAiChat,p):jsx(AccountAiChat,p)');
  assert.throws(() => verifyCloudConsole(inverted), /Enabled production branch/);
});
