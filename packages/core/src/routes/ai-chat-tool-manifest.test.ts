import { type OpenAPIV3 } from 'openapi-types';

import { buildManagementToolManifest } from './ai-chat-tool-manifest.js';

// The fixture is a partial document: the generator reads only the fields it sets here.

const document = {
  openapi: '3.0.1',
  info: { title: 'test', version: '1' },
  components: {
    schemas: {
      Role: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['a', 'b'] } },
      },
    },
  },
  paths: {
    '/api/users/{userId}': {
      get: { operationId: 'GetUser', parameters: [{ name: 'userId', in: 'path', required: true }] },
      patch: {
        operationId: 'UpdateUser',
        parameters: [{ name: 'userId', in: 'path', required: true }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Role' } } },
        },
      },
      delete: {
        operationId: 'DeleteUser',
        parameters: [{ name: 'userId', in: 'path', required: true }],
      },
    },
    '/api/users/{userId}/mfa-verifications': {
      post: { operationId: 'CreateUserMfaVerification' },
    },
    '/api/sign-in-exp': {
      patch: { operationId: 'UpdateSignInExperience' },
    },
    '/api/roles': {
      get: { operationId: 'ListRoles', parameters: [{ name: 'page', in: 'query' }] },
    },
    '/api/my-account': {
      patch: { operationId: 'UpdateMyAccount' },
    },
    '/api/kubo/stacks': {
      get: { operationId: 'ListKuboStacks' },
      post: { operationId: 'CreateKuboStack' },
    },
    '/api/kubo/stacks/{namespace}/{name}': {
      delete: { operationId: 'DeleteKuboStack' },
    },
  },
} as unknown as OpenAPIV3.Document;

describe('buildManagementToolManifest', () => {
  const tools = buildManagementToolManifest(document);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  it('names each tool after its operationId in snake_case', () => {
    expect(byName.has('get_user')).toBe(true);
    expect(byName.has('update_user')).toBe(true);
    expect(byName.has('list_roles')).toBe(true);
  });

  it('gives reads tier 1, writes tier 2, and deletes tier 3', () => {
    expect(byName.get('get_user')?.tier).toBe(1);
    expect(byName.get('update_user')?.tier).toBe(2);
    expect(byName.get('delete_user')).toMatchObject({ tier: 3, guard: 'delete' });
  });

  it('guards MFA and sign-in changes at tier 3, whatever their method', () => {
    expect(byName.get('create_user_mfa_verification')).toMatchObject({ tier: 3, guard: 'mfa' });
    expect(byName.get('update_sign_in_experience')).toMatchObject({ tier: 3, guard: 'sign-in' });
  });

  it('reads path parameters, query parameters, and body fields', () => {
    expect(byName.get('update_user')).toMatchObject({
      method: 'PATCH',
      path: '/users/{userId}',
      pathParams: ['userId'],
      bodyFields: [
        { name: 'name', type: 'string', required: true },
        { name: 'kind', type: 'string', required: false, enum: ['a', 'b'] },
      ],
    });
    expect(byName.get('list_roles')?.query).toEqual(['page']);
  });

  it('leaves out the experience flows and the own-account API', () => {
    expect(byName.has('update_my_account')).toBe(false);
  });

  it('offers the Kubo stack operations, with writes and deletes guarded by tier', () => {
    expect(byName.get('list_kubo_stacks')).toMatchObject({ method: 'GET', tier: 1 });
    expect(byName.get('create_kubo_stack')).toMatchObject({ method: 'POST', tier: 2 });
    expect(byName.get('delete_kubo_stack')).toMatchObject({ method: 'DELETE', tier: 3 });
  });
});
