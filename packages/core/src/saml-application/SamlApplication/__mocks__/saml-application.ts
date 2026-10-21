import { BindingType, NameIdFormat } from '@logto/schemas';
import { createLocalJWKSet } from 'jose';

import { mockApplication } from '#src/__mocks__/index.js';
import { EnvSet, getTenantEndpoint } from '#src/env-set/index.js';
import { type SamlApplicationDetails } from '#src/queries/saml-application/index.js';

// A throwaway self-signed key pair. Node rejects placeholder strings as certificates, and the
// SAML callback builds the identity provider from this certificate.
const MOCK_SAML_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIC9DCCAdygAwIBAgIUPrTyOGtuIHIVDzcJfp//VGTJSf8wDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPbG9ndG8tc2FtbC10ZXN0MB4XDTI2MTAyMTE3NDQ1NFoX
DTM2MTAxODE3NDQ1NFowGjEYMBYGA1UEAwwPbG9ndG8tc2FtbC10ZXN0MIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkGC074Y9NTFnLOewY6fzH843xc3L
GQKTCeQ6FUitKDb8CHjIBfLS3mB/6wz0cx6rJFDvCyZp3HeYtalEC67ifLnQtfqk
P7247wpiHJvZ0/JPxXmSGLp57HN3RYL6aN0H5dzdZ07RvOJqlt3PZrhj9N+CoG2b
sLFGaeYD/cH9y47e7fW0kL3+dgYf5KJk9yhgBTI1rS7VuRoV8N1S0StwAygI+eGz
7P4M3XxYVZvphg9JEBcgoBUPVr/LWfdy/98Qh5lovx6wfGnjMrO6/+hLrKg6FFFV
gDPIGkL5oC7dSAqvA99zYXi8sIFPXE6jgCvkKWMW+GAzV3rrYtrTIbNq3QIDAQAB
ozIwMDAdBgNVHQ4EFgQUWHflL0p2/SR5zinMfimRdiUz93MwDwYDVR0TAQH/BAUw
AwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAXpuDB5B9f4Nwm9KCetV0nv07T/cG3Wev
26pop86ipWD+LbPKRMSynH9GcN3JfwUygPP1yhb4deWo3uoprm9qVtemDisHQyPc
YRiVF8ZFk9WXv/Fnr6iHunwPlBoesnRBYGIsQV5N9XtGlzdEal48WeY/wnOcJDPI
B+Z6ASGB64pIqATxisaxk9G0pwpHDFviTp5h0aZZgFkHb9YgERLIFYWVRa593Hlx
iAtUUjKBnF524VayE2QcNfWMIP0XP/QaRNTwdHJN+81H4tPenvd++bi6P8groWDN
V1oW6zkc+cPxPYRqljCq8GAPIN4ZZ3bDtFpuwX8BDEq87/wqnFyfFA==
-----END CERTIFICATE-----`;

const MOCK_SAML_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCQYLTvhj01MWcs
57Bjp/MfzjfFzcsZApMJ5DoVSK0oNvwIeMgF8tLeYH/rDPRzHqskUO8LJmncd5i1
qUQLruJ8udC1+qQ/vbjvCmIcm9nT8k/FeZIYunnsc3dFgvpo3Qfl3N1nTtG84mqW
3c9muGP034KgbZuwsUZp5gP9wf3Ljt7t9bSQvf52Bh/komT3KGAFMjWtLtW5GhXw
3VLRK3ADKAj54bPs/gzdfFhVm+mGD0kQFyCgFQ9Wv8tZ93L/3xCHmWi/HrB8aeMy
s7r/6EusqDoUUVWAM8gaQvmgLt1ICq8D33NheLywgU9cTqOAK+QpYxb4YDNXeuti
2tMhs2rdAgMBAAECggEAClrVP0SVHpE01tSlzaVIW6Sc/WkoGDAbaZ8zxz5XekXk
nPBEsEsycn6LTh63aDZFN1fn/RhmiUhj7HYqX4gjIvzqCiiNdSuJ7aMErGFFJd1V
eVKhzCI7sl4JqjOdpWhiM6CRRI0zn7oWw6E+9HK5wItIlsb7CUN9oFoTOTTw8JNq
t0lpo9VxkNGHm4MniFm0SmDJGLZNhspyQAJa9Y9aI5Ruspy3XWyyiEuXlFJp8Ozm
U8ejiDOlX9Z5by59HzhAdPu23UzTWoqDgi5X0bE63I9CaFBxjSmnPVYo19xIIcSH
kYOMWh6l4uHyOnAkFhzaVUV5P3SmbdRlvT/6KVUpQQKBgQDC9i6g41KDuCUneYfV
oF3tH4QboHDvmf62ePcZXFG/oB2K+cbGjDjGFw8mmYwboqhsLwvccvUsycwY5vKz
t3QirfbnREaK6FAxzmdrs8uXQV7tTlEDe4zKyuxWnscfRf1VH1dADgBYqXexhdrv
ERvVnFyFRkAA8I6XltYeNsMZEQKBgQC9lFGn7wtv8Yq/nCJvxtjddgY3mMQFsABb
P/MiWZ6TToNelxynOG1o7LCguB9d34sj75/F9H1+6MAkFJTvC7S+6Ea96oyWY+gg
txLZmSPYgQd0VnLPvjgKyAJoOCcz2QXRGChjF1LYrdo6BSmDnr2JlCvGtiS96cq/
Ewl6JvDVDQKBgBhnDgEPUwWvp97gBFOF5hvHBRccJuampM4cJ/mhp43PscLybqHt
bTHGMxxGvdW7r08TOG3Yab24aHZ5eclq3ft1QOFDl3zNhTQmvKUrdQEyqnoTgmpo
LYA4lApnh07vyLy91oLq/bobRCMROQ0RXCWJk78OwvYbJg3tUFGp0xOxAoGBAKC6
Pdyd+1lmNJcs/bk8oiJobO738sFLrZGvjygBSUNknlY00ZMocQIzIbCxSc6htuq5
vwDqvvc4x6YPWRGuIAh3D3r2f0kF3QjXjgC0KELnafWFUYO1pvflCL1pVjtL9PWI
gL06Sf/wrYLhW4f+rn0VBWRMiqwEqeMDddZ9a1OFAoGAcJw9qIFyhUA+3ilswx5v
qSAEuD6kDJj7SadIV/Xebfph1q5DL56henIajnIBtvMktKhmQjCH5OIA/+dureTb
fmCyL5wWOKMxKe28M2+yLSN8lvwo6/845bCvHOlWLgFkBcDyE3fnjpmAtr9aOjzo
z0ozKvZ5j5f9OXwUEnhLTA0=
-----END PRIVATE KEY-----`;

export const createMockSamlApplicationDetails = (
  overrides: Partial<SamlApplicationDetails> = {}
): SamlApplicationDetails => ({
  ...mockApplication,
  entityId: 'sp-entity-id',
  acsUrl: { binding: BindingType.Post, url: 'https://sp.example.com/acs' },
  oidcClientMetadata: { redirectUris: ['https://logto.test/callback'], postLogoutRedirectUris: [] },
  privateKey: MOCK_SAML_PRIVATE_KEY,
  certificate: MOCK_SAML_CERTIFICATE,
  secret: 'mock-secret',
  nameIdFormat: NameIdFormat.Persistent,
  attributeMapping: {},
  encryption: null,
  authnRequestConfig: null,
  active: true,
  expiresAt: null,
  ...overrides,
});

export const createMockSamlEnvSet = (oidc: Partial<EnvSet['oidc']> = {}) => {
  const envSet = new EnvSet('tenant-id', EnvSet.values.dbUrl);
  import.meta.jest
    .spyOn(envSet, 'endpoint', 'get')
    .mockReturnValue(getTenantEndpoint('tenant-id', EnvSet.values));
  import.meta.jest.spyOn(envSet, 'oidc', 'get').mockReturnValue({
    issuer: 'https://issuer.example.com',
    cookieKeys: [],
    privateJwks: [],
    publicJwks: [],
    localJWKSet: createLocalJWKSet({ keys: [] }),
    jwkSigningAlg: 'ES256',
    sessionTtl: 3600,
    cimdEnabled: false,
    ...oidc,
  });
  return envSet;
};
