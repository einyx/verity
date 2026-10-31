import {
  demoAppApplicationId,
  LogtoOidcConfigKeyType,
  OidcSigningKeyStatus,
  SupportedSigningKeyAlgorithm,
} from '@logto/schemas';
import { assert } from '@silverhand/essentials';
import { createRemoteJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import ky from 'ky';

import { deleteOidcKey, getOidcKeys, rotateOidcKeys } from '#src/api/logto-config.js';
import { discoveryUrl, logtoOidcUrl } from '#src/constants.js';
import { initExperienceClient, processSession } from '#src/helpers/client.js';
import { identifyUserWithUsernamePassword } from '#src/helpers/experience/index.js';
import { expectRejects } from '#src/helpers/index.js';
import { enableAllPasswordSignInMethods } from '#src/helpers/sign-in-experience.js';
import { UserApiTest } from '#src/helpers/user.js';
import {
  devFeatureDisabledTest,
  devFeatureTest,
  generatePassword,
  generateUsername,
  waitFor,
} from '#src/utils.js';

const keyType = LogtoOidcConfigKeyType.PrivateKeys;
const jwksUrl = new URL(`${logtoOidcUrl}/jwks`);

// Key rotation invalidates the tenant cache asynchronously. Poll the actual discovery endpoint
// instead of assuming the rotation response means the provider has already been rebuilt.
const expectMlDsaDiscovery = async (enabled: boolean, retries = 20): Promise<void> => {
  const discovery = await ky.get(discoveryUrl).json<{
    issuer: string;
    jwks_uri: string;
    id_token_signing_alg_values_supported: string[];
  }>();
  const advertised = discovery.id_token_signing_alg_values_supported.includes('ML-DSA-65');

  if (advertised !== enabled && retries > 0) {
    await waitFor(200);
    return expectMlDsaDiscovery(enabled, retries - 1);
  }

  expect(discovery.issuer).toBe(logtoOidcUrl);
  expect(discovery.jwks_uri).toBe(jwksUrl.href);
  expect(advertised).toBe(enabled);
};

const signInAndGetIdToken = async (username: string, password: string) => {
  const client = await initExperienceClient();
  await identifyUserWithUsernamePassword(client, username, password);
  const { redirectTo } = await client.submitInteraction();
  // This also exercises the existing Node SDK's callback/token validation, not just jose directly.
  await processSession(client, redirectTo);
  const idToken = await client.getIdToken();
  assert(idToken, new Error('Login did not issue an ID token'));
  return idToken;
};

const restoreEcSigning = async () => {
  const keys = await getOidcKeys(keyType);
  const currentKey = keys.find(({ status }) => status === OidcSigningKeyStatus.Current);
  const restored =
    currentKey?.signingKeyAlgorithm === SupportedSigningKeyAlgorithm.EC
      ? keys
      : await rotateOidcKeys(keyType, SupportedSigningKeyAlgorithm.EC, 0);
  const previousMlDsaKey = restored.find(
    ({ signingKeyAlgorithm, status }) =>
      signingKeyAlgorithm === SupportedSigningKeyAlgorithm.ML_DSA_65 &&
      status === OidcSigningKeyStatus.Previous
  );

  if (previousMlDsaKey) {
    await deleteOidcKey(keyType, previousMlDsaKey.id);
  }

  await expectMlDsaDiscovery(false);
};

// Register beside the other key-rotation tests, before their staged-rotation case. A staged Next
// key deliberately prevents immediate rotation, so independent Jest file ordering is unsafe here.
export const describePostQuantumSigning = () => {
  describe('post-quantum OIDC signing', () => {
    devFeatureDisabledTest.it(
      'rejects ML-DSA rotation without changing the signing keys',
      async () => {
        const before = await getOidcKeys(keyType);

        try {
          await expectRejects(rotateOidcKeys(keyType, SupportedSigningKeyAlgorithm.ML_DSA_65, 0), {
            code: 'oidc.invalid_request',
            status: 422,
          });

          expect(await getOidcKeys(keyType)).toEqual(before);
          await expectMlDsaDiscovery(false);
          const { keys } = await ky.get(jwksUrl).json<JSONWebKeySet>();
          expect(keys.some(({ kty }) => kty === 'AKP')).toBe(false);
        } finally {
          // A broken guard may mutate state even when the test expects rejection. Restore usable
          // signing in that failure case instead of contaminating every subsequent API suite.
          if (JSON.stringify(await getOidcKeys(keyType)) !== JSON.stringify(before)) {
            await restoreEcSigning();
          }
        }
      }
    );

    // Dev feature: live post-quantum signing coverage. The server and test runner must both support
    // ML-DSA (Node.js 24.7+); unsupported runtimes must fail rather than silently skip this coverage.
    devFeatureTest.it(
      'signs logins with ML-DSA and verifies retired tokens after EC rotation',
      async () => {
        const users = new UserApiTest();
        const username = generateUsername();
        const password = generatePassword();

        try {
          await enableAllPasswordSignInMethods();
          const user = await users.create({ username, password });
          const rotated = await rotateOidcKeys(keyType, SupportedSigningKeyAlgorithm.ML_DSA_65, 0);
          expect(
            rotated.find(({ status }) => status === OidcSigningKeyStatus.Current)
          ).toMatchObject({
            signingKeyAlgorithm: 'ML-DSA-65',
          });
          await expectMlDsaDiscovery(true);

          const token = await signInAndGetIdToken(username, password);
          const options = { issuer: logtoOidcUrl, audience: demoAppApplicationId };
          const verified = await jwtVerify(token, createRemoteJWKSet(jwksUrl), {
            ...options,
            algorithms: ['ML-DSA-65'],
          });
          expect(verified.payload.sub).toBe(user.id);
          expect(verified.protectedHeader.alg).toBe('ML-DSA-65');
          expect(verified.protectedHeader.kid).toEqual(expect.any(String));

          const { keys } = await ky.get(jwksUrl).json<JSONWebKeySet>();
          const publicKey = keys.find(({ kid }) => kid === verified.protectedHeader.kid);
          expect(publicKey).toMatchObject({ kty: 'AKP', alg: 'ML-DSA-65' });
          expect(publicKey?.pub).toEqual(expect.any(String));
          expect(publicKey).not.toHaveProperty('priv');
          expect(publicKey).not.toHaveProperty('d');

          const ecKeys = await rotateOidcKeys(keyType, SupportedSigningKeyAlgorithm.EC, 0);
          expect(
            ecKeys.find(({ status }) => status === OidcSigningKeyStatus.Previous)
          ).toMatchObject({
            signingKeyAlgorithm: 'ML-DSA-65',
          });
          await expectMlDsaDiscovery(false);

          const ecToken = await signInAndGetIdToken(username, password);
          const ecVerified = await jwtVerify(ecToken, createRemoteJWKSet(jwksUrl), {
            ...options,
            algorithms: ['ES384'],
          });
          expect(ecVerified.payload.sub).toBe(user.id);
          expect(ecVerified.protectedHeader.alg).toBe('ES384');
          expect(ecVerified.protectedHeader.kid).not.toBe(verified.protectedHeader.kid);

          // A new resolver must fetch the post-rotation JWKS; a cached pre-rotation key would hide
          // regressions where retiring the ML-DSA key accidentally removes it from the public set.
          const retiredVerified = await jwtVerify(token, createRemoteJWKSet(jwksUrl), {
            ...options,
            algorithms: ['ML-DSA-65'],
          });
          expect(retiredVerified.payload.sub).toBe(user.id);
        } finally {
          try {
            await restoreEcSigning();
          } finally {
            await users.cleanUp();
          }
        }
      }
    );
  });
};
