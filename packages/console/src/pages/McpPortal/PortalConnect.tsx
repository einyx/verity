import { useState } from 'react';

import FormCard from '@/components/FormCard';
import Button from '@/ds-components/Button';
import DangerousRaw from '@/ds-components/DangerousRaw';

import styles from './index.module.scss';
import { type Portal } from './types';

type Client = 'claude' | 'codex' | 'opencode';

const clients: Client[] = ['claude', 'codex', 'opencode'];

const clientLabels: Record<Client, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/** The URL, a short name for the portal, and each client's setup command. */
const getPortalSetup = (portal: Portal) => {
  const url = `https://${portal.hostname}/mcp`;
  const name = portal.name.toLowerCase().replaceAll(/[^\da-z]+/g, '-') || 'portal';
  const commands: Record<Client, string> = {
    claude: `claude mcp add --transport http ${name} ${url}`,
    codex: `codex mcp add ${name} --url ${url}`,
    opencode: JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        mcp: { [name]: { type: 'remote', url } },
      },
      null,
      2
    ),
  };
  const setupPrompt = [
    "Add this MCP portal to my MCP client. Run the command for the client you use, restart it, then confirm the portal's servers are listed.",
    '',
    `Portal URL: ${url}`,
    '',
    `Claude Code: ${commands.claude}`,
    `Codex: ${commands.codex}`,
    `OpenCode (add to opencode.json):\n${commands.opencode}`,
  ].join('\n');

  return { url, commands, setupPrompt };
};

/** How people connect their agents to this portal. The URL is the only thing they need to paste. */
function PortalConnect({ portal }: { readonly portal: Portal }) {
  const [client, setClient] = useState<Client>('claude');
  const [copied, setCopied] = useState<'url' | 'command'>();
  const { url, commands } = getPortalSetup(portal);

  const copy = async (value: string, which: 'url' | 'command') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
    } catch {
      // Clipboard access can be refused; the text stays selectable on screen.
      setCopied(undefined);
    }
  };

  return (
    <FormCard title={<DangerousRaw>Connect</DangerousRaw>}>
      <p className={styles.description}>
        Give this address to anyone who should use the servers in this portal. They sign in once,
        and their organization decides whether they get in.
      </p>
      <div className={styles.copyRow}>
        <code className={styles.code}>{url}</code>
        <Button
          type="outline"
          size="small"
          title={<DangerousRaw>{copied === 'url' ? 'Copied' : 'Copy'}</DangerousRaw>}
          onClick={() => {
            void copy(url, 'url');
          }}
        />
      </div>

      <p className={styles.muted}>Or add it to your client:</p>
      <div className={styles.clientTabs} role="tablist" aria-label="MCP client">
        {clients.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={client === item}
            className={styles.clientTab}
            onClick={() => {
              setClient(item);
              setCopied(undefined);
            }}
          >
            {clientLabels[item]}
          </button>
        ))}
      </div>
      <div className={styles.commandBox}>
        <pre className={styles.commandText}>{commands[client]}</pre>
        <Button
          type="outline"
          size="small"
          title={<DangerousRaw>{copied === 'command' ? 'Copied' : 'Copy command'}</DangerousRaw>}
          onClick={() => {
            void copy(commands[client], 'command');
          }}
        />
      </div>
      {client === 'opencode' && (
        <p className={styles.muted}>Put this in opencode.json in your project or home directory.</p>
      )}
    </FormCard>
  );
}

/** Pill banner at the top of the portal page: one click copies a setup prompt for an agent. */
export function SetupBanner({ portal }: { readonly portal: Portal }) {
  const [copied, setCopied] = useState(false);
  const { setupPrompt } = getPortalSetup(portal);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(setupPrompt);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the Connect card below still shows the config.
      setCopied(false);
    }
  };

  return (
    <div className={styles.banner}>
      <span>Onboard your agent to this portal</span>
      <Button
        type="primary"
        size="small"
        title={<DangerousRaw>{copied ? 'Copied' : 'Copy setup prompt'}</DangerousRaw>}
        onClick={() => {
          void copyPrompt();
        }}
      />
    </div>
  );
}

export default PortalConnect;
