import { generateKeyPairSync } from 'node:crypto';

import type { AlipayNativeConfig } from './types.js';

export const mockedTimestamp = '2022-02-22 22:22:22';

const mockedAlipayKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const mockedAlipayPrivateKey = mockedAlipayKeyPair.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
export const mockedAlipayPublicKey = mockedAlipayKeyPair.publicKey.export({
  type: 'spki',
  format: 'pem',
});

export const mockedAlipayNativeConfig: AlipayNativeConfig = {
  appId: '2021000000000000',
  signType: 'RSA2',
  privateKey: '<private-key>',
};

export const mockedAlipayNativeConfigWithValidPrivateKey: AlipayNativeConfig = {
  appId: '2021000000000000',
  signType: 'RSA2',
  privateKey: mockedAlipayPrivateKey,
};

export const mockedAlipayNativePublicParameters = {
  format: 'JSON',
  grantType: 'authorization_code',
  timestamp: mockedTimestamp,
  version: '1.0',
  charset: 'utf8',
  method: '<method-placeholder>',
};
