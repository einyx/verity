import { generateKeyPair, type KeyObject } from 'node:crypto';
import { promisify } from 'node:util';

import { exportJWK, isMlDsaSupported } from './jwks.js';

// @types/node does not type ML-DSA key types yet, so the generator is widened to accept the name.
const generateMlDsaKey = promisify(generateKeyPair) as unknown as (
  type: 'ml-dsa-65'
) => Promise<{ privateKey: KeyObject }>;

// ML-DSA requires Node.js 24.7+; skip the post-quantum cases on runtimes without it.
const supportsMlDsa = await generateMlDsaKey('ml-dsa-65').then(
  () => true,
  () => false
);
const itIfMlDsa = supportsMlDsa ? it : it.skip;

describe('exportJWK', () => {
  itIfMlDsa('should export an ML-DSA key as an AKP JWK with a stable kid', async () => {
    const { privateKey } = await generateMlDsaKey('ml-dsa-65');

    const jwk = await exportJWK(privateKey);
    const jwkAgain = await exportJWK(privateKey);

    expect(jwk.kty).toBe('AKP');
    expect(jwk.alg).toBe('ML-DSA-65');
    expect(jwk.pub).toBeTruthy();
    expect(jwk.kid).toBeTruthy();
    expect(jwkAgain.kid).toBe(jwk.kid);
  });

  itIfMlDsa('should derive different kids for different ML-DSA keys', async () => {
    const firstKeyPair = await generateMlDsaKey('ml-dsa-65');
    const secondKeyPair = await generateMlDsaKey('ml-dsa-65');
    const first = await exportJWK(firstKeyPair.privateKey);
    const second = await exportJWK(secondKeyPair.privateKey);

    expect(first.kid).not.toBe(second.kid);
  });
});

describe('isMlDsaSupported', () => {
  it.each([
    ['22.14.0', false],
    ['24.6.9', false],
    ['24.7.0', true],
    ['24.12.1', true],
    ['26.12.0', true],
  ])('returns the support status for Node.js %s', (nodeVersion, expected) => {
    expect(isMlDsaSupported(nodeVersion)).toBe(expected);
  });
});
