import type { AsymmetricSigningAlgorithm } from 'oidc-provider';

/**
 * Asymmetric signing algorithms the bundled oidc-provider types accept, including ML-DSA.
 * The `satisfies` clause checks every entry against the provider's union at compile time.
 */
const asymmetricSigningAlgs = [
  'PS256',
  'PS384',
  'PS512',
  'Ed25519',
  'ES256',
  'ES384',
  'ES512',
  'RS256',
  'RS384',
  'RS512',
  'ML-DSA-44',
  'ML-DSA-65',
  'ML-DSA-87',
  'EdDSA',
] as const satisfies readonly AsymmetricSigningAlgorithm[];

// A string set, since the literal tuple type rejects a plain string in `includes`.
const asymmetricSigningAlgSet = new Set<string>(asymmetricSigningAlgs);

const isAsymmetricSigningAlg = (alg: string): alg is (typeof asymmetricSigningAlgs)[number] =>
  asymmetricSigningAlgSet.has(alg);

/**
 * Narrow the tenant signing algorithm (a plain string read from the key's JWK) to the algorithms
 * oidc-provider accepts. Unknown values throw, since they would otherwise fail later at token issuance.
 */
export const toAsymmetricSigningAlg = (
  alg: string | undefined
): AsymmetricSigningAlgorithm | undefined => {
  if (alg === undefined) {
    return undefined;
  }

  if (isAsymmetricSigningAlg(alg)) {
    return alg;
  }

  throw new TypeError(`Unsupported OIDC signing algorithm: ${alg}`);
};
