/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- The stand-in server is created once per suite, so its handle and origin are assigned in beforeAll. */
import { type Server } from 'node:http';
import { createServer } from 'node:http';

import Koa from 'koa';
import request from 'supertest';

import koaLandingProxy, { isLandingPath } from './koa-landing-proxy.js';

// A stand-in for the site's server: it answers every path with its own path, so the test can see
// what was forwarded.
let site: Server;
let siteOrigin: string;

beforeAll(async () => {
  site = createServer((incoming, outgoing) => {
    outgoing.setHeader('content-type', 'text/plain');
    outgoing.end(`site:${incoming.method}:${incoming.url}`);
  });
  await new Promise<void>((resolve) => {
    site.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = site.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  siteOrigin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    site.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

const createApp = () => {
  const app = new Koa();
  app.use(koaLandingProxy(siteOrigin));
  app.use((ctx) => {
    ctx.body = `logto:${ctx.path}`;
  });
  return app.callback();
};

describe('landing proxy', () => {
  it('serves the root from the site', async () => {
    const response = await request(createApp()).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toBe('site:GET:/');
  });

  it('forwards the site pages and their files with the query string', async () => {
    const response = await request(createApp()).get('/demo/sent?intent=demo');
    expect(response.text).toBe('site:GET:/demo/sent?intent=demo');
    const asset = await request(createApp()).get('/_astro/app.css');
    expect(asset.text).toBe('site:GET:/_astro/app.css');
  });

  it('leaves the console and the Logto endpoints to Logto', async () => {
    const console = await request(createApp()).get('/console');
    expect(console.text).toBe('logto:/console');
    const api = await request(createApp()).get('/api/tenants');
    expect(api.text).toBe('logto:/api/tenants');
  });

  it('does not forward writes', async () => {
    const response = await request(createApp()).post('/');
    expect(response.text).toBe('logto:/');
  });

  it('matches whole path segments only', () => {
    expect(isLandingPath('/about')).toBe(true);
    expect(isLandingPath('/aboutness')).toBe(false);
    expect(isLandingPath('/console/welcome')).toBe(false);
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */
