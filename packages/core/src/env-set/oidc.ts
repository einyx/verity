import crypto from 'node:crypto';

import type { CimdConfig, LogtoOidcConfigType } from '@logto/schemas';
import {
  LogtoOidcConfigKey,
  OidcSigningKeyStatus,
  getCurrentOidcPrivateKey,
  getOidcProviderPrivateKeys,
} from '@logto/schemas';
import { conditional } from '@silverhand/essentials';
import { createLocalJWKSet } from 'jose';

import { getOidcProviderPublicJwks } from '#src/libraries/oidc-private-key.js';
import { exportJWK } from '#src/utils/jwks.js';

/** The ML-DSA algorithms Logto generates for AKP keys. Any other value is not a signing algorithm oidc-provider accepts. */
const akpSigningAlgs = ['ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87'] as const;

const getAkpSigningAlg = (alg: string | undefined) =>
  akpSigningAlgs.find((candidate) => candidate === alg);

const getEcSigningAlg = (crv: string | undefined) => {
  switch (crv) {
    case 'P-256': {
      return 'ES256';
    }
    case 'P-384': {
      return 'ES384';
    }
    case 'P-521': {
      return 'ES512';
    }
    default:
  }
};

/**
 * Dev feature: post-quantum signing keys. ML-DSA keys are removed from the provider keystore
 * (and so from JWKS) when dev features are disabled.
 */
const excludeMlDsaKeys = async (keys: LogtoOidcConfigType[LogtoOidcConfigKey.PrivateKeys]) => {
  const keyTypes = await Promise.all(
    keys.map(async ({ value }) => {
      const jwk = await exportJWK(crypto.createPrivateKey(value));

      return jwk.kty;
    })
  );

  return keys.filter((_, index) => keyTypes[index] !== 'AKP');
};

const loadOidcValues = async (
  issuer: string,
  configs: LogtoOidcConfigType,
  cimdConfig: CimdConfig,
  isDevFeaturesEnabled = false
) => {
  const cookieKeys = configs[LogtoOidcConfigKey.CookieKeys].map(({ value }) => value);
  const currentPrivateKey = crypto.createPrivateKey(
    getCurrentOidcPrivateKey(configs[LogtoOidcConfigKey.PrivateKeys]).value
  );
  const currentPrivateJwk = await exportJWK(currentPrivateKey);

  if (!isDevFeaturesEnabled && currentPrivateJwk.kty === 'AKP') {
    throw new Error(
      'The current OIDC signing key is ML-DSA, which requires dev features to be enabled.'
    );
  }

  const providerPrivateKeyConfigs = isDevFeaturesEnabled
    ? configs[LogtoOidcConfigKey.PrivateKeys]
    : await excludeMlDsaKeys(configs[LogtoOidcConfigKey.PrivateKeys]);
  const session = configs[LogtoOidcConfigKey.Session];
  const privateJwks = await Promise.all(
    getOidcProviderPrivateKeys(providerPrivateKeyConfigs).map(async ({ value, status }) => {
      const jwk = await exportJWK(crypto.createPrivateKey(value));

      // A key that is not current (retired, or staged for a later rotation) still verifies tokens it
      // issued, but must never sign. The keystore's signing lookup honors key_ops, so restricting it
      // to "verify" is enough, for every key type.
      return status === OidcSigningKeyStatus.Current ? jwk : { ...jwk, key_ops: ['verify'] };
    })
  );
  const publicJwks = await getOidcProviderPublicJwks(providerPrivateKeyConfigs);
  const localJWKSet = createLocalJWKSet({ keys: publicJwks });

  /**
   * The declared algorithm must match the current key's actual curve — Logto generates P-384
   * keys, but seeded keys (`OIDC_PRIVATE_KEYS`) may be on any supported curve, and a mismatched
   * declaration falls outside the algorithms the tenant can sign with.
   * RSA keys stay `undefined` to fall back to the oidc-provider `RS256` defaults, for backwards
   * compatibility since we were using RSA keys before v1.0.0-beta.20.
   */
  const jwkSigningAlg =
    conditional(currentPrivateJwk.kty === 'EC' && getEcSigningAlg(currentPrivateJwk.crv)) ??
    (currentPrivateJwk.kty === 'AKP' ? getAkpSigningAlg(currentPrivateJwk.alg) : undefined);

  return Object.freeze({
    cookieKeys,
    privateJwks,
    publicJwks,
    jwkSigningAlg,
    localJWKSet,
    sessionTtl: session.ttl,
    cimdEnabled: cimdConfig.enabled,
    issuer,
  });
};

export default loadOidcValues;
