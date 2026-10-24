import type { createConsoleSsoRouter } from './console-sso/router.js';

export { createBillingRouter } from './billing/router.js';
export { createBillingComposer, stripeWebhookPath } from './billing-server.js';
export { createPgBillingStore } from './billing/pg-store.js';
export { migrateBillingSchema } from './billing/schema.js';
export { createInMemoryBillingStore, type BillingStore } from './billing/store.js';
export { subscriptionGuard, type Subscription } from './billing/subscription.js';
export { createBillingHandler } from './billing-server.js';
export { createConsoleSsoRouter, type ConsoleSsoRouterConfig } from './console-sso/router.js';
export { createPgConsoleSsoStore } from './console-sso/pg-store.js';
export { consoleSsoSchemaSql } from './console-sso/schema.js';
export { createInMemoryConsoleSsoStore, type ConsoleSsoStore } from './console-sso/store.js';
export { consoleSsoProviders, type ConsoleSsoConnector } from './console-sso/types.js';

/** Type-only handle for the console's typed API client. The router is built by the cloud server, not imported here. */
export declare const consoleSsoRouter: ReturnType<typeof createConsoleSsoRouter>;
export { createClientCredentialsToken } from './console-sso/token.js';
export { createVaultSecrets } from './console-sso/vault-secrets.js';
export { createCoreSsoClient } from './console-sso/core-client.js';
