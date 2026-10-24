import { z } from 'zod';

import { type ConsoleSsoSecrets } from './core-binding.js';

export type VaultSecretsOptions = {
  /** Vault base URL, e.g. `https://vault.example.com`. */
  baseUrl: string;
  /** KV v2 mount, e.g. `secret`. */
  mount: string;
  /** Returns a Vault token for the cloud service. */
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
};

const kvReadGuard = z.object({ data: z.object({ data: z.object({ value: z.string() }) }) });

/**
 * Stores each connection's client secret in Vault KV v2 under `console-sso/<connectorId>`. The
 * database never holds the secret; only the connection's ID is known to Vault.
 */
export const createVaultSecrets = (options: VaultSecretsOptions): ConsoleSsoSecrets => {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  const path = (connectorId: string) =>
    `${base}/v1/${options.mount}/data/console-sso/${encodeURIComponent(connectorId)}`;

  const headers = async () => ({
    'x-vault-token': await options.getToken(),
    'content-type': 'application/json',
  });

  return {
    async putClientSecret(connectorId, secret) {
      const response = await doFetch(path(connectorId), {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ data: { value: secret } }),
      });

      if (!response.ok) {
        throw new Error(`Vault write failed with ${response.status}`);
      }
    },
    async getClientSecret(connectorId) {
      const response = await doFetch(path(connectorId), { headers: await headers() });

      if (response.status === 404) {
        return;
      }

      if (!response.ok) {
        throw new Error(`Vault read failed with ${response.status}`);
      }

      const parsed = kvReadGuard.safeParse(await response.json());

      if (!parsed.success) {
        throw new Error('Vault secret has an unexpected shape');
      }

      return parsed.data.data.data.value;
    },
  };
};
