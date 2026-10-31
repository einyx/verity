import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

import LogtoClient from '@logto/node';
import { yes } from '@silverhand/essentials';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportsMlDsa = nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 7);

// Exercise the SDK's default verifier, including its own transitive jose dependency. Importing
// this package's jose alone would miss regressions where the SDK still resolves jose 5.
for (const algorithm of ['ML-DSA-65', 'ES384', 'RS256']) {
  test(
    `the Node SDK validates ${algorithm} tokens without weakening claim or signature checks`,
    {
      // Preserve classical SDK coverage on the integration package's supported Node 22 runtime.
      // With dev features enabled, an unsupported ML-DSA runtime must fail rather than skip.
      skip:
        algorithm === 'ML-DSA-65' && !supportsMlDsa && !yes(process.env.DEV_FEATURES_ENABLED)
          ? 'ML-DSA requires Node.js 24.7+; DEV_FEATURES_ENABLED=1 makes this coverage mandatory'
          : false,
    },
    async () => {
      const { privateKey, publicKey } = await generateKeyPair(algorithm);
      const jwk = { ...(await exportJWK(publicKey)), kid: 'sdk-signing-key' };
      const server = createServer((request, response) => {
        response.setHeader('content-type', 'application/json');

        if (request.url === '/oidc/.well-known/openid-configuration') {
          response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
          return;
        }

        if (request.url === '/oidc/jwks') {
          response.end(JSON.stringify({ keys: [jwk] }));
          return;
        }

        response.writeHead(404).end();
      });

      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const endpoint = `http://127.0.0.1:${server.address().port}`;
      const issuer = `${endpoint}/oidc`;
      const appId = 'sdk-jwt-verification';
      const storage = new Map();
      const client = new LogtoClient(
        { endpoint, appId },
        {
          navigate: async () => {},
          storage: {
            getItem: async (key) => storage.get(key) ?? null,
            setItem: async (key, value) => {
              storage.set(key, value);
            },
            removeItem: async (key) => {
              storage.delete(key);
            },
          },
        }
      );
      const now = Math.floor(Date.now() / 1000);
      const sign = (claims = {}, key = privateKey) =>
        new SignJWT({
          sub: 'sdk-user',
          iss: issuer,
          aud: appId,
          iat: now,
          exp: now + 600,
          ...claims,
        })
          .setProtectedHeader({ alg: algorithm, kid: jwk.kid })
          .sign(key);

      try {
        await assert.doesNotReject(client.jwtVerifier.verifyIdToken(await sign()));

        const rogue = await generateKeyPair(algorithm);
        await assert.rejects(client.jwtVerifier.verifyIdToken(await sign({}, rogue.privateKey)), {
          code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
        });
        await assert.rejects(
          client.jwtVerifier.verifyIdToken(await sign({ iss: `${issuer}/wrong` })),
          { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' }
        );
        await assert.rejects(
          client.jwtVerifier.verifyIdToken(await sign({ aud: 'another-client' })),
          { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' }
        );
        // The SDK permits five minutes of clock skew; exceed it to test actual expiry rejection.
        await assert.rejects(client.jwtVerifier.verifyIdToken(await sign({ exp: now - 600 })), {
          code: 'ERR_JWT_EXPIRED',
          claim: 'exp',
        });
        await assert.rejects(client.jwtVerifier.verifyIdToken(await sign({ iat: now - 600 })), {
          code: 'id_token.invalid_iat',
        });
      } finally {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    }
  );
}
