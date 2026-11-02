import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

test('proxy middleware resolves the Koa types matching the actual Core runtime', () => {
  const core = createRequire(new URL('../packages/core/package.json', import.meta.url));
  const proxy = createRequire(core.resolve('koa-proxies/package.json'));
  const runtimeMajor = Number(core('koa/package.json').version.split('.')[0]);
  const coreTypesMajor = Number(core('@types/koa/package.json').version.split('.')[0]);
  const proxyTypesMajor = Number(proxy('@types/koa/package.json').version.split('.')[0]);
  assert.equal(coreTypesMajor, runtimeMajor);
  assert.equal(proxyTypesMajor, coreTypesMajor, 'Proxy declarations must not depend on a hoisted Koa 2 type package');
});
