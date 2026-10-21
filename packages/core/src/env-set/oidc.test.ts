import assert from 'node:assert';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';

import {
  LogtoOidcConfigKey,
  OidcSigningKeyStatus,
  defaultCimdConfig,
  type LogtoOidcConfigType,
} from '@logto/schemas';
import { SignJWT, importJWK, jwtVerify } from 'jose';

import { exportJWK } from '#src/utils/jwks.js';

import loadOidcValues from './oidc.js';

const issuer = 'https://logto.test/oidc';

const generateEcPrivateKeyPem = (namedCurve: string) =>
  generateKeyPairSync('ec', { namedCurve })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();

// @types/node does not type ML-DSA key types yet, so the generator is widened to accept the name.
const generateMlDsaPrivateKeyPem = () => {
  const generate = generateKeyPairSync as unknown as (type: 'ml-dsa-65') => {
    privateKey: { export: (options: Record<string, unknown>) => string };
  };

  return generate('ml-dsa-65').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
};

const generateRsaPrivateKeyPem = () =>
  generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();

const buildConfigs = (privateKeyPems: string[]): LogtoOidcConfigType => ({
  [LogtoOidcConfigKey.PrivateKeys]: privateKeyPems.map((value, index) => ({
    id: `private-key-${index}`,
    value,
    createdAt: index,
    status: index === 0 ? OidcSigningKeyStatus.Current : OidcSigningKeyStatus.Previous,
  })),
  [LogtoOidcConfigKey.CookieKeys]: [{ id: 'cookie-key', value: 'cookie-key-value', createdAt: 0 }],
  [LogtoOidcConfigKey.Session]: {},
});

describe('loadOidcValues', () => {
  it.each([
    ['prime256v1', 'ES256'],
    ['secp384r1', 'ES384'],
    ['secp521r1', 'ES512'],
  ])('derives the signing algorithm from the %s current key', async (namedCurve, expected) => {
    const { jwkSigningAlg, privateJwks, localJWKSet } = await loadOidcValues(
      issuer,
      buildConfigs([generateEcPrivateKeyPem(namedCurve)]),
      defaultCimdConfig
    );

    expect(jwkSigningAlg).toBe(expected);

    /**
     * The declared algorithm must be one the current key can actually sign with — with a
     * mismatched declaration (e.g. `ES384` hardcoded for a P-256 key), `importJWK` rejects the
     * curve and this round trip fails.
     */
    const [currentPrivateJwk] = privateJwks;
    assert(currentPrivateJwk && jwkSigningAlg);
    const signingKey = await importJWK(currentPrivateJwk, jwkSigningAlg);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: jwkSigningAlg, kid: currentPrivateJwk.kid })
      .sign(signingKey);
    const { protectedHeader } = await jwtVerify(jwt, localJWKSet);

    expect(protectedHeader.alg).toBe(expected);
  });

  it('keeps the signing algorithm undefined for an RSA current key', async () => {
    const { jwkSigningAlg } = await loadOidcValues(
      issuer,
      buildConfigs([generateRsaPrivateKeyPem()]),
      defaultCimdConfig
    );

    expect(jwkSigningAlg).toBeUndefined();
  });

  it('follows the current key when a previous key of another type remains in rotation grace', async () => {
    const { jwkSigningAlg, privateJwks, publicJwks } = await loadOidcValues(
      issuer,
      buildConfigs([generateEcPrivateKeyPem('prime256v1'), generateRsaPrivateKeyPem()]),
      defaultCimdConfig
    );

    expect(jwkSigningAlg).toBe('ES256');
    expect(privateJwks).toHaveLength(2);
    expect(publicJwks).toHaveLength(2);
  });

  describe('ML-DSA keys', () => {
    // ML-DSA requires Node.js 24.7+; skip these cases on runtimes without it.
    const supportsMlDsa = (() => {
      try {
        generateMlDsaPrivateKeyPem();
        return true;
      } catch {
        return false;
      }
    })();
    const itIfMlDsa = supportsMlDsa ? it : it.skip;

    itIfMlDsa('excludes ML-DSA keys from the keystore when dev features are disabled', async () => {
      const { privateJwks, publicJwks, jwkSigningAlg } = await loadOidcValues(
        issuer,
        buildConfigs([generateEcPrivateKeyPem('prime256v1'), generateMlDsaPrivateKeyPem()]),
        defaultCimdConfig,
        false
      );

      expect(jwkSigningAlg).toBe('ES256');
      expect(privateJwks.map(({ kty }) => kty)).toEqual(['EC']);
      expect(publicJwks.map(({ kty }) => kty)).toEqual(['EC']);
    });

    itIfMlDsa('keeps ML-DSA keys in the keystore when dev features are enabled', async () => {
      const { privateJwks, publicJwks } = await loadOidcValues(
        issuer,
        buildConfigs([generateEcPrivateKeyPem('prime256v1'), generateMlDsaPrivateKeyPem()]),
        defaultCimdConfig,
        true
      );

      expect(privateJwks).toHaveLength(2);
      expect(privateJwks).toEqual(
        expect.arrayContaining([expect.objectContaining({ kty: 'AKP' })])
      );
      expect(publicJwks).toHaveLength(2);
    });

    itIfMlDsa('uses ML-DSA-65 as the signing algorithm for an ML-DSA current key', async () => {
      const { jwkSigningAlg } = await loadOidcValues(
        issuer,
        buildConfigs([generateMlDsaPrivateKeyPem()]),
        defaultCimdConfig,
        true
      );

      expect(jwkSigningAlg).toBe('ML-DSA-65');
    });

    itIfMlDsa('rejects an ML-DSA current key when dev features are disabled', async () => {
      await expect(
        loadOidcValues(
          issuer,
          buildConfigs([generateMlDsaPrivateKeyPem()]),
          defaultCimdConfig,
          false
        )
      ).rejects.toThrow('requires dev features to be enabled');
    });
  });
});

describe('retired signing keys', () => {
  it.each([
    ['RSA', generateRsaPrivateKeyPem],
    ['EC', () => generateEcPrivateKeyPem('prime256v1')],
  ])(
    'marks a retired %s key verify-only and leaves the current key signable',
    async (_, makePem) => {
      const currentPem = makePem();
      const retiredPem = makePem();
      const loaded = await loadOidcValues(
        issuer,
        buildConfigs([currentPem, retiredPem]),
        defaultCimdConfig
      );
      const currentJwk = await exportJWK(createPrivateKey(currentPem));
      const retiredJwk = await exportJWK(createPrivateKey(retiredPem));
      const keyOpsByKid = new Map(loaded.privateJwks.map((jwk) => [jwk.kid, jwk.key_ops]));

      expect(keyOpsByKid.get(retiredJwk.kid)).toEqual(['verify']);
      expect(keyOpsByKid.get(currentJwk.kid)).toBeUndefined();
    }
  );
});

describe('ML-DSA-65 key use', () => {
  const supportsMlDsaRuntime = (() => {
    try {
      generateMlDsaPrivateKeyPem();
      return true;
    } catch {
      return false;
    }
  })();
  const itIfMlDsaRuntime = supportsMlDsaRuntime ? it : it.skip;

  itIfMlDsaRuntime(
    'marks a retired ML-DSA key verify-only and leaves the current key signable',
    async () => {
      const currentPem = generateMlDsaPrivateKeyPem();
      const retiredPem = generateMlDsaPrivateKeyPem();
      const loaded = await loadOidcValues(
        issuer,
        {
          [LogtoOidcConfigKey.PrivateKeys]: [
            {
              id: 'current',
              value: currentPem,
              createdAt: 2,
              status: OidcSigningKeyStatus.Current,
            },
            {
              id: 'retired',
              value: retiredPem,
              createdAt: 1,
              status: OidcSigningKeyStatus.Previous,
            },
          ],
          [LogtoOidcConfigKey.CookieKeys]: [
            { id: 'cookie-key', value: 'cookie-key-value', createdAt: 0 },
          ],
          [LogtoOidcConfigKey.Session]: {},
        },
        defaultCimdConfig,
        true
      );
      const currentJwk = await exportJWK(createPrivateKey(currentPem));
      const retiredJwk = await exportJWK(createPrivateKey(retiredPem));
      const keyOpsByKid = new Map(loaded.privateJwks.map((jwk) => [jwk.kid, jwk.key_ops]));

      expect(keyOpsByKid.get(retiredJwk.kid)).toEqual(['verify']);
      expect(keyOpsByKid.get(currentJwk.kid)).toBeUndefined();
    }
  );
});
