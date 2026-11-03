import path from 'node:path';

import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import svgr from 'vite-plugin-svgr';

const owned = new Map<string, { vite: ViteDevServer; origin: string }>();
test.beforeAll(async () => {
  const boundary = '/tests/browser/fixtures/kubo-boundaries.tsx';
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    define: { 'process.env': {} },
    cacheDir: '.cache/node_modules/kubo-browser',
    resolve: { alias: { '@': path.resolve('src') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'owned-kubo-auth-api-boundaries',
        enforce: 'pre',
        resolveId(id) {
          const source = id.replace(`${path.resolve('src')}/`, '@/');
          if (
            [
              '@logto/react',
              '@/hooks/use-api',
              '@/contexts/TenantsProvider',
              '@/hooks/use-theme',
              '@/hooks/use-tenant-pathname',
              '@/consts/env',
            ].includes(source)
          ) {
            return `\0kubo:${source}`;
          }
        },
        load(id) {
          if (!id.startsWith('\0kubo:')) {
            return;
          }
          if (id.endsWith('@logto/react')) {
            return `export { useFixtureAuth as useLogto } from '${boundary}';`;
          }
          if (id.endsWith('use-api')) {
            return `export { useFixtureApi as default } from '${boundary}';`;
          }
          if (id.endsWith('TenantsProvider')) {
            return `export { TenantsContext } from '${boundary}';`;
          }
          if (id.endsWith('use-theme')) {
            return "export default () => 'light';";
          }
          if (id.endsWith('use-tenant-pathname')) {
            return "import { useNavigate } from 'react-router-dom'; export default () => ({ navigate: useNavigate(), getTo: (path) => path });";
          }
          return 'export const isCloud = false; export const isDevFeaturesEnabled = true;';
        },
        configureServer(server) {
          server.middlewares.use('/__kubo-fixture', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              await server.transformIndexHtml(
                '/__kubo-fixture',
                '<html><body><div id="app"></div><script type="module" src="/tests/browser/fixtures/kubo.tsx"></script></body></html>'
              )
            );
          });
        },
      },
      react(),
      svgr(),
    ],
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('No owned fixture port');
  }
  owned.set('current', { vite, origin: `http://127.0.0.1:${address.port}` });
});
test.afterAll(async () => {
  await owned.get('current')?.vite.close();
});

test('owned A/B/operator routes never reuse old scope data and restrict actions', async ({
  page,
}) => {
  const requests: string[] = [];
  const writes: Array<{ url: string; body: unknown }> = [];
  const failures: string[] = [];
  const readiness = new Map([['enabled', true]]);
  page.on('pageerror', (error) => {
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Append observed browser evidence to this test's local ledger.
    failures.push(error.message);
  });
  await page.route('**/__kubo-api/**', async (route) => {
    const url = new URL(route.request().url());
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Append observed requests to this test's local ledger.
    requests.push(url.pathname + url.search);
    const segments = url.pathname.split('/');
    const actor = segments[2];
    const tenant = segments[3];
    const resource = segments.slice(6).join('/');
    const all = url.searchParams.get('scope') === 'all';
    if (route.request().method() !== 'GET') {
      // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Capture synthetic writes; no live API is available to the fixture.
      writes.push({ url: url.href, body: route.request().postDataJSON() });
      readiness.set('enabled', false);
      await route.fulfill({ status: 503, json: { message: 'Fixture readiness revoked' } });
      return;
    }
    const detail = {
      namespace: 'team',
      name: 'product',
      consoleTenantId: tenant,
      mode: 'Direct',
      phase: 'Ready',
      ready: 1,
      total: 1,
      components: [{ name: `owned-${tenant}`, phase: 'Ready' }],
    };
    const data =
      resource === 'access'
        ? {
            canViewAll: actor === 'operator',
            operator: all && actor === 'operator',
            tenantScoped: !all,
            tenantMutationsEnabled: readiness.get('enabled'),
            canMutate: actor !== 'readonly' && readiness.get('enabled'),
          }
        : resource === 'stacks'
          ? [{ ...detail, name: all ? 'system-stack' : `secret-${tenant}`, age: '1h' }]
          : resource.startsWith('stacks/')
            ? detail
            : resource === 'template'
              ? { yaml: 'owned synthetic preview' }
              : resource === 'agentfw/stats'
                ? { total_requests: 1 }
                : resource === 'agentfw/requests'
                  ? { requests: [], total: 0 }
                  : resource === 'kshows'
                    ? {
                        nodes: [
                          {
                            name: 'fixture-node',
                            roles: ['worker'],
                            ready: true,
                            allocatable: { cpuMillis: 1000, memBytes: 1024 ** 3 },
                            usage: { cpuMillis: 0, memBytes: 0 },
                            hasUsage: false,
                            disk: { capacityBytes: 1024 ** 3, usedBytes: 0, live: false },
                            pods: [],
                          },
                        ],
                        capabilities: { metrics: false, disk: false },
                        generatedAt: new Date().toISOString(),
                      }
                    : resource === 'demorequests'
                      ? []
                      : { workerNodes: 0, memoryCapacityBytes: 0, cpuCapacityMilli: 0 };
    await route.fulfill({ json: data });
  });
  // The capacity map polls on a timer, so the clock is installed before it mounts.
  await page.clock.install();
  await page.goto(`${owned.get('current')?.origin}/__kubo-fixture`);
  await expect(page.getByRole('link', { name: 'secret-a', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /operator view/ })).toHaveCount(0);
  await page.getByLabel('Fixture tenant').selectOption('b');
  await expect(page.getByRole('link', { name: 'secret-a', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'secret-b', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('tenant-b.png'), fullPage: true });
  await page.getByRole('link', { name: '/agent', exact: true }).click();
  await expect(page.getByText('infrastructure.agent_title', { exact: false })).toHaveCount(0);
  await page.getByRole('link', { name: '/capacity', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Cluster capacity' })).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Node fixture-node — open detail view' })
  ).toBeVisible();
  await page.getByRole('link', { name: '/bundle', exact: true }).click();
  await expect(page.getByText('Upload an offline bundle')).toHaveCount(0);
  expect(requests.some((url) => /economics|agentfw|demorequests|airgap/.test(url))).toBe(false);
  await page.getByRole('link', { name: '/new', exact: true }).click();
  await expect(page.getByText('V1 demo', { exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: /Foundation/ })
    .first()
    .click();
  await page.getByRole('button', { name: /general.next/ }).click();
  await page.getByPlaceholder('acme').fill('namespace-slug');
  await expect(page.getByPlaceholder('Direct')).toHaveCount(0);
  await page.getByRole('button', { name: /general.next/ }).click();
  await expect(page.getByText('owned synthetic preview')).toBeVisible();
  await page.getByRole('button', { name: /general.create/ }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByText('Fixture readiness revoked')).toBeVisible();
  await expect(page.getByRole('button', { name: /general.create/ })).toBeDisabled();
  expect(writes[0]?.body).toEqual({
    template: 'full',
    tenant: 'namespace-slug',
    mode: 'Direct',
    authProvider: 'logto',
  });
  readiness.set('enabled', true);
  await page.getByLabel('Fixture actor').selectOption('operator');
  await page.getByRole('link', { name: 'overview', exact: true }).click();
  await expect(page.getByRole('link', { name: 'system-stack', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '/agent', exact: true }).click();
  await expect(page.getByText('admin_console.infrastructure.agent_title')).toBeVisible();
  await page.getByRole('link', { name: '/capacity', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Cluster capacity' })).toHaveCount(1);
  await expect(page.locator('#splash')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Node fixture-node — open detail view' })
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('operator-capacity.png'), fullPage: true });
  await page.getByLabel('Fixture actor').selectOption('ordinary');
  await expect(page.getByRole('region', { name: 'Cluster capacity' })).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: /operator view/ })).toHaveCount(0);
  const capacityCalls = requests.filter((url) => url.includes('/kshows')).length;
  await page.clock.fastForward(20_000);
  expect(requests.filter((url) => url.includes('/kshows')).length).toBeGreaterThan(capacityCalls);
  await page.getByLabel('Fixture actor').selectOption('operator');
  await page.getByRole('link', { name: '/bundle', exact: true }).click();
  await expect(page.getByText('Upload an offline bundle')).toBeVisible();
  await page.getByRole('link', { name: '/stacks/team/product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete stack', exact: true })).toBeEnabled();
  await page.getByLabel('Fixture tenant').selectOption('a');
  await page.getByLabel('Fixture actor').selectOption('readonly');
  await expect(page.getByRole('button', { name: 'Delete stack', exact: true })).toBeDisabled();
  expect(
    requests
      .filter((url) => /economics|agentfw|demorequests/.test(url))
      .every((url) => url.includes('scope=all'))
  ).toBe(true);
  expect(failures).toEqual([]);
});

test('late A data and unloaded B detail never enable B target actions', async ({ page }) => {
  const held = new Map<string, () => void>();
  await page.route('**/__kubo-api/**', async (route) => {
    const url = new URL(route.request().url());
    const tenant = url.pathname.split('/')[3];
    const isDetail = url.pathname.endsWith('/stacks/team/product');
    if (url.pathname.endsWith('/access')) {
      await route.fulfill({
        json: {
          canViewAll: false,
          operator: false,
          tenantScoped: true,
          tenantMutationsEnabled: true,
          canMutate: true,
        },
      });
      return;
    }
    if ((tenant === 'a' && !isDetail) || (tenant === 'b' && isDetail)) {
      await new Promise<void>((resolve) => {
        held.set(tenant === 'a' ? 'a-list' : 'b-detail', resolve);
      });
    }
    const detail = {
      namespace: 'team',
      name: 'product',
      consoleTenantId: tenant,
      mode: 'Direct',
      phase: 'Ready',
      ready: 1,
      total: 1,
      components: [{ name: `owned-${tenant}`, phase: 'Ready' }],
    };
    await route.fulfill({
      json: isDetail ? detail : [{ ...detail, name: `secret-${tenant}`, age: '1h' }],
    });
  });
  await page.goto(`${owned.get('current')?.origin}/__kubo-fixture`);
  await expect.poll(() => held.has('a-list')).toBe(true);
  await page.getByLabel('Fixture tenant').selectOption('b');
  await expect(page.getByRole('link', { name: 'secret-b', exact: true })).toBeVisible();
  held.get('a-list')?.();
  await expect(page.getByRole('link', { name: 'secret-a', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '/stacks/team/product', exact: true }).click();
  await expect.poll(() => held.has('b-detail')).toBe(true);
  await expect(page.getByRole('button', { name: 'Delete stack', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /tabs.run_bootstrap/ })).toHaveCount(0);
  held.get('b-detail')?.();
  await expect(page.getByRole('button', { name: 'Delete stack', exact: true })).toBeEnabled();
  await expect(page.getByText('owned-a', { exact: true })).toHaveCount(0);
  await expect(page.getByText('owned-b', { exact: true })).toBeVisible();
});
