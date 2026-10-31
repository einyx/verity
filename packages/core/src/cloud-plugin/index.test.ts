import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = mkdtempSync(path.join(tmpdir(), 'cloud-plugin-'));
const loaderFor = (name: string, source?: string) => {
  const root = path.join(directory, name);
  mkdirSync(root, { recursive: true });
  if (source !== undefined) {
    const plugin = path.join(root, 'node_modules/@meshx/cloud');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(
      path.join(plugin, 'package.json'),
      JSON.stringify({
        name: '@meshx/cloud',
        type: 'module',
        exports: { './routes': './routes.mjs' },
      })
    );
    writeFileSync(path.join(plugin, 'routes.mjs'), source);
  }
  // Run in Node itself: Jest replaces createRequire resolution with its own module registry.
  return (operation: string): unknown =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import { createCloudPluginLoader } from ${JSON.stringify(new URL('loader.js', import.meta.url).href)};
      const loader = createCloudPluginLoader(${JSON.stringify(pathToFileURL(path.join(root, 'host.mjs')).href)});
      const result = await (async () => { ${operation} })();
      console.log(JSON.stringify(result));
    `,
        ],
        { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } }
      )
    );
};

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

it('supports a public installation without the private package', async () => {
  const evaluate = loaderFor('absent');
  expect(evaluate('return loader.isInstalled();')).toBe(false);
  expect(
    evaluate('try { await loader.load(); } catch (error) { return error.message; }')
  ).toContain('Cloud plugin is not installed');
});

it('loads and caches the installed plugin exports', async () => {
  const evaluate = loaderFor(
    'valid',
    `
    export const createBillingComposer = () => ({});
    export const createBillingHandler = () => () => {};
    export const createPgBillingStore = () => ({});
    export const migrateBillingSchema = async () => {};
    export const stripeWebhookPath = '/api/webhooks/stripe';
  `
  );
  expect(
    evaluate(`
    const plugin = await loader.load();
    return [loader.isInstalled(), plugin.stripeWebhookPath, await loader.load() === plugin];
  `)
  ).toEqual([true, '/api/webhooks/stripe', true]);
});

it('rejects incompatible exports instead of disabling billing', async () => {
  const evaluate = loaderFor('invalid', 'export const stripeWebhookPath = 7;');
  expect(evaluate('return loader.isInstalled();')).toBe(true);
  expect(
    evaluate('try { await loader.load(); } catch (error) { return error.message; }')
  ).toContain('Incompatible cloud plugin');
});

it('propagates missing transitive dependencies from an installed plugin', async () => {
  const evaluate = loaderFor('broken', "import 'missing-cloud-plugin-dependency';");
  expect(evaluate('return loader.isInstalled();')).toBe(true);
  expect(
    evaluate('try { await loader.load(); } catch (error) { return error.message; }')
  ).toContain('missing-cloud-plugin-dependency');
});

it('does not treat an installed package with missing build output as absent', async () => {
  const evaluate = loaderFor('unbuilt', '');
  rmSync(path.join(directory, 'unbuilt/node_modules/@meshx/cloud/routes.mjs'));
  expect(evaluate('return loader.isInstalled();')).toBe(true);
  expect(evaluate('try { await loader.load(); } catch (error) { return error.code; }')).toBe(
    'MODULE_NOT_FOUND'
  );
});
