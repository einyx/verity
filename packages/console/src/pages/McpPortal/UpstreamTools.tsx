import { useState } from 'react';
import useSWR from 'swr';

import useApi from '@/hooks/use-api';
import { type RequestError } from '@/hooks/use-api';

import styles from './index.module.scss';
import { type Tool, type Upstream, type ToolsResponse } from './types';

// One server's tools, each with its own switch. Opening the list asks the portal for the tools.
function UpstreamTools({
  listKey,
  upstream,
  onChanged,
}: {
  readonly listKey: string;
  readonly upstream: Upstream;
  readonly onChanged: () => Promise<unknown>;
}) {
  const api = useApi();
  const toolsKey = `${listKey}/${encodeURIComponent(upstream.name)}/tools`;
  const { data, error, isLoading, mutate } = useSWR<ToolsResponse, RequestError>(toolsKey);
  const [saveError, setSaveError] = useState<string>();

  const setToolEnabled = async (toolName: string, enabled: boolean) => {
    const disabled = new Set(upstream.disabledTools ?? []);

    if (enabled) {
      disabled.delete(toolName);
    } else {
      disabled.add(toolName);
    }

    setSaveError(undefined);

    try {
      await api.patch(`${listKey}/${encodeURIComponent(upstream.name)}`, {
        json: { disabledTools: [...disabled] },
      });
      await Promise.all([onChanged(), mutate()]);
    } catch {
      setSaveError(`Could not update "${toolName}". Try again.`);
    }
  };

  if (isLoading) {
    return <p className={styles.muted}>Loading tools…</p>;
  }

  if (error) {
    return <p className={styles.error}>Could not load tools. The server may be offline.</p>;
  }

  const tools = data?.tools ?? [];
  const enabledCount = tools.filter((tool) => tool.enabled).length;

  return (
    <div>
      {tools.length === 0 && <p className={styles.muted}>This server has no tools.</p>}
      {tools.length > 0 && (
        <p className={styles.toolsSummary}>
          {enabledCount} of {tools.length} tools enabled
        </p>
      )}
      <div className={styles.toolList}>
        {tools.map((tool) => (
          <ToolRow
            key={tool.name}
            tool={tool}
            onToggle={() => {
              void setToolEnabled(tool.name, !tool.enabled);
            }}
          />
        ))}
      </div>
      {saveError && (
        <p role="alert" className={styles.error}>
          {saveError}
        </p>
      )}
    </div>
  );
}

// Descriptions can be long prompts. Keep them to a few lines until the admin asks for the rest.
const collapsedLength = 160;

function ToolRow({ tool, onToggle }: { readonly tool: Tool; readonly onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = tool.description.length > collapsedLength;

  return (
    <div className={styles.toolRow}>
      <div className={styles.toolText}>
        <div className={styles.toolName}>{tool.name}</div>
        {tool.description && (
          <>
            <p className={styles.toolDescription} data-collapsed={isLong && !expanded}>
              {tool.description}
            </p>
            {isLong && (
              <button
                type="button"
                className={styles.toolMore}
                aria-expanded={expanded}
                onClick={() => {
                  setExpanded((value) => !value);
                }}
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={tool.enabled}
        aria-label={`${tool.name} enabled`}
        className={styles.toggle}
        data-on={tool.enabled}
        onClick={onToggle}
      >
        <span />
      </button>
    </div>
  );
}

export default UpstreamTools;
