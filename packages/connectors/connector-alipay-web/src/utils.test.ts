import crypto from 'node:crypto';

import { methodForAccessToken } from './constant.js';
import {
  mockedAlipayConfigWithValidPrivateKey,
  mockedAlipayPublicKey,
  mockedAlipayPublicParameters,
} from './mock.js';
import { signingParameters } from './utils.js';

const listenJSONParse = vi.spyOn(JSON, 'parse');
const listenJSONStringify = vi.spyOn(JSON, 'stringify');

describe('signingParameters', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const testingParameters = {
    ...mockedAlipayPublicParameters,
    ...mockedAlipayConfigWithValidPrivateKey,
    method: methodForAccessToken,
    code: '7ffeb112fbb6495c9e7dfb720380DD39',
  };

  const verifySignature = (parameters: typeof testingParameters) => {
    const signedParameters = signingParameters(parameters);
    const { sign, ...unsignedParameters } = signedParameters;
    const signingContent = Object.entries(unsignedParameters)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => `${key}=${value}`)
      .slice()
      .sort()
      .join('&');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signingContent, 'utf8');
    verifier.end();

    expect(verifier.verify(mockedAlipayPublicKey, sign, 'base64')).toBe(true);

    return signedParameters.sign;
  };

  it('should return a signature that verifies with the generated test key pair', () => {
    verifySignature(testingParameters);
  });

  it('should ignore empty properties when creating a verifiable signature', () => {
    const signature = verifySignature(testingParameters);
    const signatureWithEmptyProperty = verifySignature({
      ...testingParameters,
      emptyProperty: '',
    });
    expect(signatureWithEmptyProperty).toBe(signature);
  });

  it('should not call JSON.parse() when biz_content is empty', () => {
    signingParameters(testingParameters);
    expect(listenJSONParse).not.toHaveBeenCalled();
  });

  it('should call JSON.parse() when biz_content is not empty', () => {
    signingParameters({
      ...testingParameters,
      biz_content: JSON.stringify({ AB: 'AB' }),
    });
    expect(listenJSONParse).toHaveBeenCalled();
  });

  it('should call JSON.stringify() when some value is object string', () => {
    signingParameters({
      ...testingParameters,
      testObject: JSON.stringify({ AB: 'AB' }),
    });
    expect(listenJSONStringify).toHaveBeenCalled();
  });
});
