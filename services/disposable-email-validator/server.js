import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import { domainToASCII, pathToFileURL } from 'node:url';

import { disposableEmailBlocklistSet } from 'disposable-email-domains-js';
import express from 'express';
import { rateLimit as createRateLimit } from 'express-rate-limit';
import validator from 'validator';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('./dataset.json', import.meta.url), 'utf8'));
const defaultDatasetPath = require.resolve('disposable-email-domains-js/dist/dict/disposable_email_blocklist.json');

export function loadDataset({
  now = Date.now,
  expectedSha256 = manifest.sha256,
  datasetPath = defaultDatasetPath,
} = {}) {
  try {
    const sha256 = createHash('sha256').update(readFileSync(datasetPath)).digest('hex');
    if (sha256 !== expectedSha256) {
      throw new Error('dataset_integrity');
    }
    const domains = disposableEmailBlocklistSet();
    // Bind the maintained package's parsed lookup to the verified bytes without introducing
    // a separate domain-list parser. Upstream publishes this JSON with a final newline.
    const lookupSha256 = createHash('sha256').update(JSON.stringify([...domains], null, 2) + '\n').digest('hex');
    if (lookupSha256 !== sha256) {
      throw new Error('dataset_lookup_integrity');
    }
    if (domains.size < 1000 || !domains.has('mailinator.com') || domains.has('gmail.com') || domains.has('outlook.com')) {
      throw new Error('dataset_sentinel');
    }
    return {
      ready: () => now() >= Date.parse(manifest.reviewedAt) && now() < Date.parse(manifest.expiresAt),
      has: (domain) => domains.has(domain),
    };
  } catch {
    return { ready: () => false, has: () => { throw new Error('dataset_unavailable'); } };
  }
}

export function normalizeDomain(email) {
  if (typeof email !== 'string' || email.length > 254 || !validator.isEmail(email, {
    allow_display_name: false,
    allow_ip_domain: false,
    domain_specific_validation: false,
    allow_utf8_local_part: true,
  })) {
    return undefined;
  }
  const domain = domainToASCII(email.slice(email.lastIndexOf('@') + 1)).toLowerCase();
  if (!domain || domain.endsWith('.') || !validator.isFQDN(domain, { allow_trailing_dot: false })) {
    return undefined;
  }
  return domain;
}

export function createApp({ key, dataset = loadDataset(), rateLimit = 600, unauthenticatedRateLimit = 1200 } = {}) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) {
    throw new Error('invalid_configuration');
  }
  const keyDigest = createHash('sha256').update(key).digest();
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', false);
  app.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/livez', (_request, response) => response.json({ status: 'live' }));
  app.get('/readyz', (_request, response) => {
    response.status(dataset.ready() ? 200 : 503).json({ status: dataset.ready() ? 'ready' : 'unavailable' });
  });
  const path = '/api/disposable-email-domain-validation';
  app.use(path, createRateLimit({
    windowMs: 60_000,
    limit: unauthenticatedRateLimit,
    keyGenerator: () => 'pre-authentication',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  }));
  app.use(path, (request, response, next) => {
    const supplied = request.get('x-functions-key') ?? '';
    if (!timingSafeEqual(keyDigest, createHash('sha256').update(supplied).digest())) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });
  // Aggregate replica-local ceiling bounds work even when a caller rotates source addresses.
  app.use(path, createRateLimit({
    windowMs: 60_000,
    limit: rateLimit,
    keyGenerator: () => 'validator',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  }));
  app.post(path, (request, response, next) => {
    if (!request.is('application/json') || request.headers['content-encoding']) {
      response.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    next();
  }, express.json({ limit: 1024, strict: true, inflate: false }), (request, response) => {
    const body = request.body;
    const domain = body && !Array.isArray(body) && Object.keys(body).length === 1 && normalizeDomain(body.email);
    if (!domain) {
      response.status(400).json({ error: 'invalid_request' });
      return;
    }
    if (!dataset.ready()) {
      response.status(503).json({ error: 'dataset_unavailable' });
      return;
    }
    response.json({ isDisposable: dataset.has(domain) });
  });
  app.use((_request, response) => response.status(404).json({ error: 'not_found' }));
  // Never log errors: body-parser errors can contain the original request body.
  app.use((error, _request, response, _next) => {
    const tooLarge = error.type === 'entity.too.large';
    const malformed = error.type === 'entity.parse.failed';
    const unsupported = error.type === 'charset.unsupported';
    response.status(tooLarge ? 413 : malformed ? 400 : unsupported ? 415 : 503).json({
      error: tooLarge ? 'body_too_large' : malformed ? 'invalid_request' : unsupported ? 'unsupported_media_type' : 'unavailable',
    });
  });
  return app;
}

export function createTlsServer({ key, cert }, app) {
  const server = https.createServer({
    key,
    cert,
    minVersion: 'TLSv1.2',
    handshakeTimeout: 2000,
    maxHeaderSize: 8192,
    requestTimeout: 5000,
    headersTimeout: 5000,
    connectionsCheckingInterval: 1000,
    keepAliveTimeout: 1000,
  }, app);
  server.setTimeout(5000, (socket) => socket.destroy());
  server.on('tlsClientError', (_error, socket) => socket.destroy());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Production transport is TLS only; there is deliberately no HTTP fallback.
  const app = createApp({ key: readFileSync('/run/validator/key', 'utf8').trim() });
  const server = createTlsServer({
    key: readFileSync('/run/tls/tls.key'),
    cert: readFileSync('/run/tls/tls.crt'),
  }, app);
  server.listen(8443, '0.0.0.0');
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
