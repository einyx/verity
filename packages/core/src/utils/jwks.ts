/**
 * Theses codes comes from [node-oidc-provider](https://github.com/panva/node-oidc-provider):
 * - [initialize_keystore.js](https://github.com/panva/node-oidc-provider/blob/9da61e9c9dc6152cd1140d42ea06abe1d812c286/lib/helpers/initialize_keystore.js#L13-L36)
 */

import { createHash } from 'node:crypto';

import { type JWK, exportJWK as joseExportJWK } from 'jose';

const getCalculateKidComponents = (jwk: JWK) => {
  switch (jwk.kty) {
    case 'RSA': {
      return {
        e: jwk.e,
        kty: 'RSA',
        n: jwk.n,
      };
    }

    case 'EC': {
      return {
        crv: jwk.crv,
        kty: 'EC',
        x: jwk.x,
        y: jwk.y,
      };
    }

    case 'OKP': {
      return {
        crv: jwk.crv,
        kty: 'OKP',
        x: jwk.x,
      };
    }

    // Post-quantum (ML-DSA) keys use the AKP key type; RFC members are `alg` and `pub`.
    case 'AKP': {
      return {
        alg: jwk.alg,
        kty: 'AKP',
        pub: jwk.pub,
      };
    }
    default:
  }
};

const calculateKid = (jwk: JWK) => {
  const components = getCalculateKidComponents(jwk);

  return createHash('sha256').update(JSON.stringify(components)).digest().toString('base64url');
};

/**
 * ML-DSA is available in `node:crypto` from Node.js 24.7 onwards. Older runtimes cannot
 * generate or use ML-DSA keys.
 */
export const isMlDsaSupported = (nodeVersion = process.versions.node) => {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);

  return major > 24 || (major === 24 && minor >= 7);
};

export const exportJWK = async (key: Parameters<typeof joseExportJWK>[0]): Promise<JWK> => {
  const jwk = await joseExportJWK(key);

  return {
    ...jwk,
    kid: calculateKid(jwk),
  };
};
