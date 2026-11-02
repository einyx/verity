import { defaultLandingPageContent } from '@logto/schemas';

import { hashBody, type PendingAction } from './ai-chat-actions.js';
import { validateStoredReview } from './ai-chat-session-review-validation.js';

const action = (tool: string, body: Record<string, unknown>): PendingAction => ({
  id: 'action',
  tenantId: 'tenant',
  userId: 'user',
  tool,
  body,
  bodyHash: hashBody(body),
  state: 'pending',
  result: null,
  expiresAt: new Date(),
});

it.each([
  ['create_organization', { name: 'Exact reviewed name' }],
  [
    'create_api_resource',
    { name: 'API', indicator: 'https://api.example.com', accessTokenTtl: 60 },
  ],
  [
    'create_application',
    {
      name: 'App',
      type: 'SPA',
      oidcClientMetadata: { redirectUris: [], postLogoutRedirectUris: [] },
    },
  ],
  ['save_landing_page_draft', defaultLandingPageContent],
] as const)(
  'validates stored %s against actual tool semantics without replacing its body',
  (tool, body) => {
    const stored = action(tool, body);
    validateStoredReview(stored);
    expect(stored.body).toBe(body);
    expect(stored.bodyHash).toBe(hashBody(body));
  }
);

it.each([
  ['create_organization', { name: 123 }],
  [
    'create_application',
    {
      name: 'App',
      type: 'invalid',
      oidcClientMetadata: { redirectUris: [], postLogoutRedirectUris: [] },
    },
  ],
  [
    'create_application',
    {
      name: 'App',
      type: 'SPA',
      oidcClientMetadata: { redirectUris: [42], postLogoutRedirectUris: [] },
    },
  ],
  ['create_api_resource', { name: 'API', indicator: 'url', accessTokenTtl: 'not a number' }],
  ['save_landing_page_draft', { sections: 'not a landing document' }],
  ['create_organization', { name: 'Valid', secret: 'injected additional field' }],
  ['unknown_write', { name: 'Unknown' }],
] as const)('rejects invalid %s even with a valid JSON body and hash', (tool, body) => {
  expect(() => {
    validateStoredReview(action(tool, body));
  }).toThrow('revision_conflict');
});

it('rejects stored hash mismatch', () => {
  expect(() => {
    validateStoredReview({ ...action('create_organization', { name: 'Name' }), bodyHash: 'bad' });
  }).toThrow('revision_conflict');
});
