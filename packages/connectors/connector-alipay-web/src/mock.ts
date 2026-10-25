import { generateKeyPairSync } from 'node:crypto';

import type { AlipayConfig } from './types.js';

export const mockedTimestamp = '2022-02-22 22:22:22';

const mockedAlipayKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const mockedAlipayPrivateKey = mockedAlipayKeyPair.privateKey
  .export({
    type: 'pkcs8',
    format: 'pem',
  })
  .toString();
export const mockedAlipayPublicKey = mockedAlipayKeyPair.publicKey
  .export({
    type: 'spki',
    format: 'pem',
  })
  .toString();

export const mockedAlipayConfig: AlipayConfig = {
  appId: '2021000000000000',
  signType: 'RSA2',
  privateKey: '<private-key>',
  charset: 'utf8',
};

export const mockedAlipayConfigWithValidPrivateKey: AlipayConfig = {
  appId: '2021000000000000',
  signType: 'RSA2',
  privateKey: mockedAlipayPrivateKey,
  charset: 'utf8',
};

export const mockedAlipayPublicParameters = {
  format: 'JSON',
  grantType: 'authorization_code',
  timestamp: mockedTimestamp,
  version: '1.0',
  method: '<method-placeholder>',
};
