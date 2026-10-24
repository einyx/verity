import { z } from 'zod';

/** Identity providers a Console SSO connection can use. Both are OIDC. */
export const consoleSsoProviderIds = ['google', 'microsoft'] as const;
export const consoleSsoProviderGuard = z.enum(consoleSsoProviderIds);
export type ConsoleSsoProviderId = z.infer<typeof consoleSsoProviderGuard>;

export const consoleSsoProviders = [
  { id: 'google', name: 'Google' },
  { id: 'microsoft', name: 'Microsoft Entra ID' },
] as const satisfies ReadonlyArray<{ id: ConsoleSsoProviderId; name: string }>;

/** A lowercase hostname such as `acme.com`, the email domain a connection covers. */
export const consoleSsoDomainNameGuard = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?!-)[\da-z-]+(\.[\da-z-]+)+$/);

export const consoleSsoDomainGuard = z.object({
  domain: z.string(),
  verifiedAt: z.string().nullable(),
});

export const consoleSsoConnectorGuard = z.object({
  id: z.string(),
  provider: consoleSsoProviderGuard,
  displayName: z.string(),
  clientId: z.string(),
  domains: z.array(consoleSsoDomainGuard),
  createdAt: z.string(),
});

export const createConsoleSsoConnectorBodyGuard = z.object({
  provider: consoleSsoProviderGuard,
  displayName: z.string().min(1).max(128),
  clientId: z.string().min(1).max(512),
  /** Stored in the secret store, never in the database or in responses. */
  clientSecret: z.string().min(1).max(4096),
});

export const addConsoleSsoDomainBodyGuard = z.object({
  domain: consoleSsoDomainNameGuard,
});

/** Returned when a domain is added: the TXT record the customer must publish to prove ownership. */
export const consoleSsoDomainChallengeGuard = z.object({
  domain: consoleSsoDomainGuard,
  challenge: z.object({
    recordName: z.string(),
    recordValue: z.string(),
  }),
});

export type ConsoleSsoConnector = z.infer<typeof consoleSsoConnectorGuard>;
export type ConsoleSsoDomain = z.infer<typeof consoleSsoDomainGuard>;
