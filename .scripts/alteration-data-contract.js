// Reviewed differences between fresh test seeds and upgrades/downgrades of the immutable
// upstream v1.44.0 baseline. These are exact row deltas, not tables/columns to ignore.
// Update deliberately when seed policy changes; unexplained or stale deltas fail CI.
const admin = { tenant_id: 'admin' };
const grant = { ...admin };
const previewApps = [
  {
    tenant_id: 'default',
    name: 'Live Preview',
    description: 'Preview for Sign-in Experience.',
    type: 'SPA',
    oidc_client_metadata: {
      redirectUris: ['http://localhost:3001/demo-app'],
      postLogoutRedirectUris: ['http://localhost:3001/demo-app'],
    },
    custom_client_metadata: {},
    protected_app_metadata: null,
    custom_data: {},
    is_third_party: false,
    app_level_access_control_enabled: false,
  },
  {
    tenant_id: 'default',
    name: 'Device Flow Preview',
    description: 'Preview for Device Authorization Flow.',
    type: 'Native',
    oidc_client_metadata: {
      redirectUris: [],
      postLogoutRedirectUris: ['http://localhost:3001/device-demo-app'],
    },
    custom_client_metadata: { isDeviceFlow: true },
    protected_app_metadata: null,
    custom_data: {},
    is_third_party: false,
    app_level_access_control_enabled: false,
  },
];
const resource = (name, indicator) => ({
  ...admin,
  name,
  indicator,
  is_default: false,
  access_token_ttl: '3600',
});
const userRole = (is_default) => ({
  ...admin,
  name: 'user',
  description: 'Default role for admin tenant.',
  type: 'User',
  is_default,
});
const editorRole = {
  ...admin,
  name: 'landing-page-editor',
  description: 'Edit and publish the meshX landing page only',
  type: 'User',
  is_default: false,
};
const accountScope = {
  ...admin,
  name: 'manage:account:self',
  description:
    'Allow managing account-level resources that are not tied to a tenant, including account deletion, billing, licenses, Console SSO, and invitations.',
};
const signInExperience = (branding, color) => ({
  ...admin,
  color,
  branding,
  hide_logto_branding: false,
  language_info: { autoDetect: true, fallbackLanguage: 'en' },
  terms_of_use_url: null,
  privacy_policy_url: null,
  agree_to_terms_policy: 'Automatic',
  sign_in: {
    methods: [
      {
        password: true,
        identifier: 'username',
        verificationCode: false,
        isPasswordPrimary: true,
      },
    ],
  },
  sign_up: { verify: false, password: true, identifiers: ['username'] },
  social_sign_in: {},
  social_sign_in_connector_targets: [],
  sign_in_mode: 'Register',
  custom_css: null,
  custom_content: {},
  custom_ui_assets: null,
  custom_ui_csp: {},
  password_policy: {},
  mfa: {
    policy: 'NoPrompt',
    factors: ['Totp', 'WebAuthn', 'BackupCode'],
    organizationRequiredMfaPolicy: 'Mandatory',
  },
  adaptive_mfa: {},
  trusted_device: {},
  single_sign_on_enabled: false,
  support_email: null,
  support_website_url: null,
  unknown_session_redirect_url: null,
  captcha_policy: {},
  sentinel_policy: {},
  email_blocklist_policy: {},
  verification_code_policy: {},
  forgot_password_methods: [],
  passkey_sign_in: {},
  sign_up_profile_fields: null,
  password_expiration: {},
  username_policy: {
    maxLength: 128,
    minLength: 1,
    allowedChars: {
      numbers: true,
      lowercase: true,
      uppercase: true,
      underscore: true,
    },
    caseSensitive: true,
  },
});
const upstreamColors = {
  primaryColor: '#6139F6',
  darkPrimaryColor: '#8768F8',
  isDarkModeEnabled: true,
};
const freshSignIn = signInExperience(
  {
    logoUrl: 'https://console.example.com/console/meshx-logo.svg',
    darkLogoUrl: 'https://console.example.com/console/meshx-logo-dark.svg',
  },
  {
    primaryColor: '#FE330A',
    darkPrimaryColor: '#FE5E3E',
    isDarkModeEnabled: true,
  }
);
const legacySignIn = (darkLogoUrl) =>
  signInExperience(
    { logoUrl: 'https://logto.io/logo.svg', darkLogoUrl },
    upstreamColors
  );
const delta = (leftOnly, rightOnly = []) => ({ leftOnly, rightOnly });
const shared = {
  // Current --test seeds register real demo clients; old test seeds relied on runtime previews.
  applications: delta(previewApps),
  // Endpoint migrations preserve non-matching/custom indicators rather than rewriting all instances.
  resources: delta(
    [
      resource('Logto Cloud API', 'http://localhost:3002/api'),
      resource('Logto Me API', 'https://admin.meshx.foundation/me'),
    ],
    [
      resource('Logto Me API', 'https://admin.logto.app/me'),
      resource('Logto Cloud API', 'https://cloud.logto.io/api'),
    ]
  ),
  // Fresh bootstrap policy adds scoped account/editor permissions; old installations keep their roles.
  roles: delta([userRole(true), editorRole], [userRole(false)]),
  scopes: delta([accountScope]),
};

export const alterationDataContract = {
  baselineTag: 'v1.44.0',
  baselineCommit: '08e3fae4cd138722196d3dddea3e1508bcb47720',
  up: {
    ...shared,
    // Operator bootstrap selects the first pre-existing admin fixture user only on upgrades.
    application_user_consent_organizations: delta(
      [],
      [{ ...admin, organization_id: 't-admin', user_id: 'test-1' }]
    ),
    application_user_consent_resource_scopes: delta([], [grant]),
    users_roles: delta([], [{ ...admin, user_id: 'test-1' }]),
    roles_scopes: delta([grant, grant]),
    sign_in_experiences: delta(
      [freshSignIn],
      [
        legacySignIn(
          'https://console.meshx.foundation/console/meshx-logo-dark.svg'
        ),
      ]
    ),
    tenants: delta(
      [
        {
          name: 'Admin',
          tag: 'development',
          is_suspended: false,
          region_name: null,
        },
      ],
      [
        {
          name: 'Admin',
          tag: 'production',
          is_suspended: false,
          region_name: null,
        },
      ]
    ),
  },
  down: {
    ...shared,
    // Rollbacks deliberately retain potentially pre-existing admin grants and branded defaults.
    organization_role_scope_relations: delta([
      { ...admin, organization_role_id: 'admin', organization_scope_id: 'all' },
    ]),
    organization_scopes: delta([
      {
        ...admin,
        name: 'all',
        description: 'Full access to the admin tenant.',
      },
    ]),
    roles_scopes: delta([grant]),
    sign_in_experiences: delta(
      [freshSignIn],
      [legacySignIn('https://logto.io/logo-dark.svg')]
    ),
    tenants: delta(
      [{ name: 'Admin', tag: 'development', is_suspended: false }],
      [{ name: 'My Project', tag: 'development', is_suspended: false }]
    ),
  },
};
