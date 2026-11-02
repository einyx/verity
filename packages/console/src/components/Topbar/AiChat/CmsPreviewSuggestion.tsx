import { useAui, useAuiState } from '@assistant-ui/react';
import { useContext } from 'react';

import { ActionContext } from './ActionContext';
import styles from './index.module.scss';

/** Ambiguous copy requests need a user click, not an inferred page-edit or another text-only offer. */
export default function CmsPreviewSuggestion() {
  const aui = useAui();
  const actionContext = useContext(ActionContext);
  const show = useAuiState((state) => {
    const latest = state.thread.messages.at(-1);
    const request = state.thread.messages.filter(({ role }) => role === 'user').at(-1);
    const text =
      request?.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n') ??
      '';
    return (
      latest?.id === state.message.id &&
      !state.thread.isRunning &&
      /^\s*(?:please\s+)?(?:generate|create|write|rewrite|suggest|improve)\b/i.test(text) &&
      !/\b(?:documentation|source\s+code|checklist|how\s+to)\b/i.test(text) &&
      /\b(?:marketing\s+hero|landing[\s-]*page|hero\s+(?:copy|section))\b/i.test(text) &&
      !/\b(?:do not|don't|never)\s+(?:preview|generate|edit)\b/i.test(text)
    );
  });
  if (!show || actionContext?.canOperate === false || actionContext?.isHydrated === false) {
    return null;
  }
  return (
    <button
      type="button"
      className={styles.artifactSecondary}
      onClick={() => {
        aui.thread().append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Show the previous marketing suggestion as an actual preview in the CMS editor. Do not save or publish.',
            },
          ],
        });
      }}
    >
      Preview in CMS
    </button>
  );
}
