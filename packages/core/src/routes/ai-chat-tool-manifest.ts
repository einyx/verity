import { type OpenAPIV3 } from 'openapi-types';

// Turns the Management API document into the tools Ask AI can offer. Each operation becomes one
// tool, named after its operationId in snake_case. The tier decides how the tool runs:
//
// - Tier 1 (read): GET. Runs directly with the caller's token.
// - Tier 2 (write): POST, PUT, PATCH. Proposed, then run when the user confirms.
// - Tier 3 (guarded): DELETE, and anything that changes MFA, sign-in methods, captcha or secrets.
//   Proposed, then run only after a typed confirmation and a re-auth in the console, with the
//   guard's own checks (see `guard`).
//
// Operations outside the admin's own management surface (the experience flows, the user's own
// account, the Kubo portal, and the OAuth callbacks) are not offered.

type ToolTier = 1 | 2 | 3;

type ToolGuard = 'delete' | 'mfa' | 'sign-in' | 'secret' | 'captcha';

type ToolField = {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly enum?: readonly string[];
};

type ManagementTool = {
  readonly name: string;
  readonly operationId: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The Management API path, without the `/api` mount. Path parameters use `{name}`. */
  readonly path: string;
  readonly pathParams: readonly string[];
  readonly query: readonly string[];
  readonly bodyFields: readonly ToolField[];
  readonly tier: ToolTier;
  readonly guard?: ToolGuard;
  readonly summary: string;
};

const excludedPrefixes = Object.freeze([
  '/api/.well-known',
  '/api/swagger.json',
  '/api/status',
  '/api/experience',
  '/api/my-account',
  '/api/verifications',
  '/api/verification-codes',
  '/api/ai-chat',
  '/api/mcp-portal/oauth',
  '/api/user-assets',
  '/api/subject-tokens',
  '/api/saml/',
]);

const httpMethods = Object.freeze(['get', 'post', 'put', 'patch', 'delete'] as const);

const methodNames: Record<(typeof httpMethods)[number], ManagementTool['method']> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
};

const toSnakeCase = (value: string) =>
  value
    .replaceAll(/([\da-z])([A-Z])/g, '$1_$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

const guardFor = (
  method: ManagementTool['method'],
  path: string
): { tier: ToolTier; guard?: ToolGuard } => {
  if (path.includes('/mfa') || path.includes('mfa-verifications')) {
    return { tier: 3, guard: 'mfa' };
  }

  if (path.includes('sign-in')) {
    return { tier: 3, guard: 'sign-in' };
  }

  if (path.includes('captcha')) {
    return { tier: 3, guard: 'captcha' };
  }

  if (path.includes('secret')) {
    return { tier: 3, guard: 'secret' };
  }

  if (method === 'DELETE') {
    return { tier: 3, guard: 'delete' };
  }

  if (method === 'GET') {
    return { tier: 1 };
  }

  return { tier: 2 };
};

/** Resolves a `$ref` to the schema it names, or returns the schema itself. */
const resolve = (
  document: OpenAPIV3.Document,
  schema: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject | undefined
): OpenAPIV3.SchemaObject | undefined => {
  if (!schema) {
    return undefined;
  }

  if ('$ref' in schema) {
    const name = schema.$ref.split('/').at(-1) ?? '';
    const found = document.components?.schemas?.[name];

    // A schema that is itself a reference is not followed; the generator only needs one level.
    return found && !('$ref' in found) ? found : undefined;
  }

  return schema;
};

const bodyFieldsOf = (
  document: OpenAPIV3.Document,
  operation: OpenAPIV3.OperationObject
): ToolField[] => {
  const body = operation.requestBody;

  if (!body || '$ref' in body) {
    return [];
  }

  const schema = resolve(document, body.content['application/json']?.schema);
  const required = new Set(schema?.required ?? []);

  return Object.entries(schema?.properties ?? {}).map(([name, property]) => {
    const resolved = resolve(document, property);

    return {
      name,
      type: resolved?.type ?? 'object',
      required: required.has(name),
      ...(resolved?.enum ? { enum: resolved.enum.map(String) } : {}),
    };
  });
};

/** Builds one tool per Management API operation, or none for operations that are not offered. */
export const buildManagementToolManifest = (document: OpenAPIV3.Document): ManagementTool[] =>
  Object.entries(document.paths).flatMap(([apiPath, item]) => {
    if (!item || excludedPrefixes.some((prefix) => apiPath.startsWith(prefix))) {
      return [];
    }

    return httpMethods.flatMap((key) => {
      const operation = item[key];

      if (!operation?.operationId) {
        return [];
      }

      const method = methodNames[key];
      const path = apiPath.replace(/^\/api/, '');
      const parameters = (operation.parameters ?? []).flatMap((parameter) =>
        '$ref' in parameter ? [] : [parameter]
      );
      const { tier, guard } = guardFor(method, path);

      return [
        {
          name: toSnakeCase(operation.operationId),
          operationId: operation.operationId,
          method,
          path,
          pathParams: parameters
            .filter((parameter) => parameter.in === 'path')
            .map((parameter) => parameter.name),
          query: parameters
            .filter((parameter) => parameter.in === 'query')
            .map((parameter) => parameter.name),
          bodyFields: bodyFieldsOf(document, operation),
          tier,
          ...(guard ? { guard } : {}),
          summary: operation.summary ?? operation.operationId,
        },
      ];
    });
  });
