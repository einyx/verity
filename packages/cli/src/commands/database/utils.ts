import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

import { type OidcConfigKey, SupportedSigningKeyAlgorithm } from '@logto/schemas';
import { generateStandardId, generateStandardSecret } from '@logto/shared';

export const generateOidcPrivateKey = async (
  type: SupportedSigningKeyAlgorithm = SupportedSigningKeyAlgorithm.EC
): Promise<OidcConfigKey> => {
  if (type === SupportedSigningKeyAlgorithm.RSA) {
    const { privateKey } = await promisify(generateKeyPair)('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return buildOidcKeyFromRawString(privateKey);
  }

  if (type === SupportedSigningKeyAlgorithm.EC) {
    const { privateKey } = await promisify(generateKeyPair)('ec', {
      // https://security.stackexchange.com/questions/78621/which-elliptic-curve-should-i-use
      namedCurve: 'secp384r1',
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return buildOidcKeyFromRawString(privateKey);
  }

  // Dev feature: post-quantum signing keys. Requires Node.js 24.7+ for ML-DSA support.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the RSA and EC branches above narrow the type to ML-DSA; the check keeps the fallthrough explicit for unchecked callers.
  if (type === SupportedSigningKeyAlgorithm.ML_DSA_65) {
    // @ts-expect-error -- @types/node does not type ML-DSA key types yet; runtime support is gated on Node.js 24.7+ above.
    const { privateKey } = await promisify(generateKeyPair)('ml-dsa-65', {
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return buildOidcKeyFromRawString(privateKey);
  }

  throw new Error(`Unsupported private key ${String(type)}`);
};

export const generateOidcCookieKey = () => buildOidcKeyFromRawString(generateStandardSecret());

export const buildOidcKeyFromRawString = (raw: string) => ({
  id: generateStandardId(),
  value: raw,
  createdAt: Math.floor(Date.now() / 1000),
});
