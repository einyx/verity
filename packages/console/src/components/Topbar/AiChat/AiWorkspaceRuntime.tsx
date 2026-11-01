import { useAuiState } from '@assistant-ui/react';
import { type ComponentProps } from 'react';

import AiWorkspace from './AiWorkspace';

export default function AiWorkspaceRuntime(
  props: Omit<ComponentProps<typeof AiWorkspace>, 'hasMessages'>
) {
  const hasMessages = useAuiState((state) => state.thread.messages.length > 0);
  return <AiWorkspace {...props} hasMessages={hasMessages} />;
}
