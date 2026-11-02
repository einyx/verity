import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import tls from 'node:tls';

const { createApp, createTlsServer, loadDataset, normalizeDomain } = await import('./server.js');
const key = randomBytes(32).toString('hex');
const now = Date.parse('2026-11-02T00:00:00Z');
const dataset = loadDataset({ now: () => now });

async function withServer(options, run) {
  const server = createApp({ key, dataset, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(async (body, headers = {}) => fetch(`${url}/api/disposable-email-domain-validation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-functions-key': key, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }), url);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('requires a strong authentication key at startup', () => {
  assert.throws(() => createApp({ dataset }), /configuration/);
  assert.throws(() => createApp({ key: 'weak', dataset }), /configuration/);
});

test('denies missing and incorrect keys without returning classification', async () => {
  await withServer({}, async (post) => {
    for (const badKey of ['', 'wrong', `${key},${key}`]) {
      const response = await post({ email: 'synthetic@mailinator.com' }, { 'x-functions-key': badKey });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'unauthorized' });
    }
  });
});

test('normalizes IDNA and case; validates an address without interpreting local-part', () => {
  assert.equal(normalizeDomain('synthetic@MAILINATOR.COM'), 'mailinator.com');
  assert.equal(normalizeDomain('synthetic@bücher.de'), 'xn--bcher-kva.de');
  assert.equal(normalizeDomain('synthetic+tag@example.com'), 'example.com');
  for (const email of ['', 'bad', 'a@@example.com', 'a@example.com.', 'a@localhost', 'a@127.0.0.1', 'a@ example.com']) {
    assert.equal(normalizeDomain(email), undefined);
  }
});

test('returns exact boolean contract for synthetic disposable and legitimate addresses', async () => {
  await withServer({}, async (post) => {
    for (const [email, isDisposable] of [
      ['synthetic@MAILINATOR.COM', true],
      ['synthetic@example.com', false],
      ['synthetic@gmail.com', false],
      ['synthetic@outlook.com', false],
      ['synthetic@mailinator.com.example.com', false],
      ['synthetic@not-listed-subdomain.mailinator.com', false],
    ]) {
      const response = await post({ email });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { isDisposable });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
});

test('rejects malformed, non-JSON, extra fields and oversized bodies generically', async () => {
  await withServer({}, async (post) => {
    for (const body of ['{', {}, [], { email: 42 }, { email: 'invalid' }, { email: 'synthetic@example.com', other: true }]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'invalid_request' });
    }
    assert.equal((await post({ email: 'synthetic@example.com' }, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post({ email: 'synthetic@example.com' }, { 'content-type': 'application/json; charset=invalid' })).status, 415);
    const response = await post({ email: 'x'.repeat(4096) });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'body_too_large' });
  });
});

test('stale dataset fails closed and readiness fails but process remains live', async () => {
  const stale = loadDataset({ now: () => Date.parse('2027-11-02T00:00:00Z') });
  await withServer({ dataset: stale }, async (post, url) => {
    assert.equal((await post({ email: 'synthetic@example.com' })).status, 503);
    assert.equal((await fetch(`${url}/readyz`)).status, 503);
    assert.equal((await fetch(`${url}/livez`)).status, 200);
  });
});

test('missing or corrupted dataset fails closed, never answers false', async () => {
  for (const options of [{ expectedSha256: 'bad' }, { datasetPath: '/nonexistent/dataset.json' }]) {
    const broken = loadDataset({ now: () => now, ...options });
    await withServer({ dataset: broken }, async (post) => {
      const response = await post({ email: 'synthetic@example.com' });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'dataset_unavailable' });
    });
  }
});

test('rate limits authenticated requests', async () => {
  await withServer({ rateLimit: 2 }, async (post) => {
    assert.equal((await post({ email: 'synthetic@example.com' })).status, 200);
    assert.equal((await post({ email: 'synthetic@example.com' })).status, 200);
    assert.equal((await post({ email: 'synthetic@example.com' })).status, 429);
  });
});

test('cannot verify one dataset but query a different package dataset', () => {
  const directory = mkdtempSync(join(tmpdir(), 'validator-integrity-'));
  try {
    const path = createRequire(import.meta.url).resolve('disposable-email-domains-js/dist/dict/disposable_email_blocklist.json');
    const changed = [...JSON.parse(readFileSync(path, 'utf8')), 'synthetic-dataset-mismatch.example'];
    const bytes = JSON.stringify(changed, null, 2) + '\n';
    const datasetPath = join(directory, 'changed.json');
    writeFileSync(datasetPath, bytes);
    assert.equal(loadDataset({ datasetPath, expectedSha256: createHash('sha256').update(bytes).digest('hex'), now: () => now }).ready(), false);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('rate limits incorrect credentials before authentication work', async () => {
  await withServer({ unauthenticatedRateLimit: 2 }, async (post) => {
    assert.equal((await post({}, { 'x-functions-key': 'wrong' })).status, 401);
    assert.equal((await post({}, { 'x-functions-key': 'wrong' })).status, 401);
    assert.equal((await post({}, { 'x-functions-key': 'wrong' })).status, 429);
  });
});

test('production TLS bounds stalled handshakes and slow headers/bodies', { timeout: 25000 }, async () => {
  assert.equal(typeof createTlsServer, 'function');
  const directory = mkdtempSync(join(tmpdir(), 'validator-tls-'));
  let server;
  try {
    const certPath = join(directory, 'cert.pem');
    const keyPath = join(directory, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
    server = createTlsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, createApp({ key, dataset }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const stalled = net.connect(port, '127.0.0.1');
    const handshakeStart = Date.now();
    stalled.resume();
    await once(stalled, 'close');
    assert.ok(Date.now() - handshakeStart < 4500);
    for (const request of [
      'POST /api/disposable-email-domain-validation HTTP/1.1\r\nHost: localhost\r\n',
      `POST /api/disposable-email-domain-validation HTTP/1.1\r\nHost: localhost\r\nx-functions-key: ${key}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`,
    ]) {
      const socket = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false });
      await once(socket, 'secureConnect');
      socket.write(request);
      const requestStart = Date.now();
      socket.resume();
      await once(socket, 'close');
      assert.ok(Date.now() - requestStart < 7500);
    }
  } finally {
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true });
  }
});
