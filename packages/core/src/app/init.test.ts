import { createServer } from 'node:http';

import { pickDefault } from '@logto/shared/esm';
import Koa from 'koa';
import request from 'supertest';

import { EnvSet } from '#src/env-set/index.js';

const { jest } = import.meta;

const getTenantId = jest.fn();
const getConsoleRedirectUrl = jest.fn();
const tenantPoolGet = jest.fn();
const trackException = jest.fn();

class TenantNotFoundError extends Error {}

jest.unstable_mockModule('@logto/app-insights/node', () => ({
  appInsights: {
    trackException,
  },
}));

jest.unstable_mockModule('#src/tenants/index.js', () => ({
  TenantNotFoundError,
  tenantPool: {
    get: tenantPoolGet,
  },
}));

jest.unstable_mockModule('#src/utils/tenant.js', () => ({
  getTenantId,
  getConsoleRedirectUrl,
  landingAssetPrefix: '/console/landing/',
  landingPreviewPath: '/console/landing-preview',
}));

const initI18n = await pickDefault(import('../i18n/init.js'));
const initApp = await pickDefault(import('./init.js'));

describe('App Init', () => {
  const listenMock = jest
    .spyOn(Koa.prototype, 'listen')
    .mockImplementation(jest.fn(() => createServer()));

  it('app init properly with 404 not found route', async () => {
    const app = new Koa();
    await initI18n();
    await initApp(app);

    expect(listenMock).toBeCalled();
  });

  it('logs tenant initialization errors to the request console', async () => {
    const tenantError = new Error('tenant init failed');
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    getTenantId.mockResolvedValueOnce(['default', false]);
    tenantPoolGet.mockRejectedValueOnce(tenantError);

    try {
      const app = new Koa();
      await initApp(app);

      const response = await request(app.callback()).get('/');

      expect(response.status).toBe(500);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]).toContain(tenantError);
      expect(trackException).toHaveBeenCalledWith(tenantError, expect.any(Object));
    } finally {
      consoleError.mockRestore();
    }
  });

  it('sends a console path to the admin console', async () => {
    getConsoleRedirectUrl.mockReturnValueOnce(new URL('https://admin.logto.mock/console'));

    const app = new Koa();
    await initApp(app);

    const response = await request(app.callback()).get('/console');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://admin.logto.mock/console');
  });

  it('serves the static landing page in local development', async () => {
    const originalIsCloud = EnvSet.values.isCloud;
    const originalIsDomainBasedMultiTenancy = EnvSet.values.isDomainBasedMultiTenancy;
    const originalIsDevFeaturesEnabled = EnvSet.values.isDevFeaturesEnabled;
    const originalIsProduction = EnvSet.values.isProduction;

    try {
      Reflect.set(EnvSet.values, 'isCloud', false);
      Reflect.set(EnvSet.values, 'isDomainBasedMultiTenancy', false);
      Reflect.set(EnvSet.values, 'isDevFeaturesEnabled', true);
      Reflect.set(EnvSet.values, 'isProduction', false);

      const app = new Koa();
      await initApp(app);

      const response = await request(app.callback()).get('/console/landing/');

      expect(response.status).toBe(200);
      expect(response.text).toContain('meshX — Enterprise intelligence that compounds');
      expect(response.text).not.toContain('<div id="app"></div>');
    } finally {
      Reflect.set(EnvSet.values, 'isCloud', originalIsCloud);
      Reflect.set(EnvSet.values, 'isDomainBasedMultiTenancy', originalIsDomainBasedMultiTenancy);
      Reflect.set(EnvSet.values, 'isDevFeaturesEnabled', originalIsDevFeaturesEnabled);
      Reflect.set(EnvSet.values, 'isProduction', originalIsProduction);
    }
  });
});
