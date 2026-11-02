import { z } from 'zod/v3';

// These are model-facing DTOs, NOT Management API serializers. Unknown fields are stripped at
// every object level. Never add config, arbitrary JSON, identities, tokens, contact data or raw logs.
const text = z.string();
const timestamp = z.union([z.string(), z.number()]);
const application = z
  .object({
    id: text,
    name: text,
    type: text,
    description: text.nullable(),
    createdAt: timestamp,
    isThirdParty: z.boolean(),
    oidcClientMetadata: z
      .object({
        redirectUris: text.array(),
        postLogoutRedirectUris: text.array(),
      })
      .partial(),
  })
  .partial();
const user = z
  .object({
    id: text,
    username: text.nullable(),
    name: text.nullable(),
    isSuspended: z.boolean(),
    createdAt: timestamp,
    lastSignInAt: timestamp.nullable(),
  })
  .partial();
const connector = z
  .object({
    id: text,
    connectorId: text,
    type: text,
    target: text,
    isDemo: z.boolean(),
    syncProfile: z.boolean(),
    enableTokenStorage: z.boolean(),
    name: z.union([text, z.record(text)]),
    description: z.union([text, z.record(text)]),
  })
  .partial();
const log = z
  .object({
    id: text,
    key: text,
    createdAt: timestamp,
    payload: z
      .object({
        key: text,
        result: z.enum(['Success', 'Error']),
        userId: text,
        applicationId: text,
      })
      .partial(),
  })
  .partial();
const organization = z.object({ id: text, name: text, description: text.nullable() }).partial();
const resource = z
  .object({
    id: text,
    name: text,
    indicator: text,
    accessTokenTtl: z.number(),
    isDefault: z.boolean(),
  })
  .partial();
const role = z.object({ id: text, name: text, description: text.nullable(), type: text }).partial();
const stack = z
  .object({
    id: text,
    name: text,
    phase: text,
    status: text,
    namespace: text,
    mode: text,
    age: text,
    ready: z.union([z.boolean(), z.number().int().nonnegative()]),
    total: z.number().int().nonnegative(),
    createdAt: timestamp,
    readiness: z.object({ ready: z.boolean(), phase: text }).partial(),
  })
  .partial();
const signIn = z
  .object({
    signInMode: text,
    hideLogtoBranding: z.boolean(),
    termsOfUseUrl: text,
    privacyPolicyUrl: text,
    agreeToTermsPolicy: text,
    color: z
      .object({ primaryColor: text, darkPrimaryColor: text, isDarkModeEnabled: z.boolean() })
      .partial(),
    branding: z
      .object({ logoUrl: text, darkLogoUrl: text, favicon: text, darkFavicon: text })
      .partial(),
    languageInfo: z.object({ autoDetect: z.boolean(), fallbackLanguage: text }).partial(),
    signIn: z
      .object({
        methods: z
          .object({
            identifier: text,
            password: z.boolean(),
            verificationCode: z.boolean(),
            isPasswordPrimary: z.boolean(),
          })
          .partial()
          .array(),
      })
      .partial(),
    signUp: z
      .object({
        identifiers: text.array(),
        password: z.boolean(),
        verify: z.boolean(),
        secondaryIdentifiers: z.object({ identifier: text, verify: z.boolean() }).partial().array(),
      })
      .partial(),
  })
  .partial();

const list = (item: z.ZodType) =>
  z.union([
    item.array(),
    z.object({ items: item.array(), totalCount: z.number().int().nonnegative().optional() }),
  ]);
const projections: Readonly<Record<string, z.ZodType>> = {
  list_applications: list(application),
  get_application: application,
  create_application: application,
  list_users: list(user),
  get_user: user,
  list_connectors: list(connector),
  get_audit_logs: list(log),
  get_sign_in_experience: signIn,
  list_organizations: list(organization),
  create_organization: organization,
  list_roles: list(role),
  list_api_resources: list(resource),
  create_api_resource: resource,
  list_foundation_stacks: z.union([list(stack), z.object({ stacks: stack.array() })]),
  save_landing_page_draft: z.object({ saved: z.boolean().optional() }),
};

/** Fail closed for any tool without an explicitly reviewed model DTO, including future tools. */
export const projectModelToolResult = (name: string, body: unknown): unknown => {
  const guard = projections[name];
  if (!guard) {
    throw new Error('No model projection');
  }
  return guard.parse(body);
};
