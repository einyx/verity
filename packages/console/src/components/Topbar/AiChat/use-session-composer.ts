import { type SessionController } from './session-controller';

/** Composer facade; storage lives in the account controller, not the mounted tab. */
export default function useSessionComposer(
  controller: SessionController | undefined,
  sessionId?: string
) {
  const snapshot = controller?.getSnapshot();
  const record = snapshot?.records[sessionId ?? ''];
  return {
    draft: record?.draft ?? snapshot?.emptyDraft ?? { text: '', attachments: [], revision: 0 },
    saveState: record?.saveState ?? 'dirty',
    conflict: record?.conflict,
    setText: (text: string) => {
      controller?.setText(text);
    },
    addAttachments: (attachments: Array<{ id: string; name: string; text: string }>) => {
      controller?.addAttachments(attachments);
    },
    removeAttachment: (id: string) => {
      controller?.removeAttachment(id);
    },
    resolveConflict: async (choice: 'load' | 'replace') => {
      if (sessionId) {
        await controller?.resolveConflict(sessionId, choice);
      }
    },
    flush: async () => controller?.flush(sessionId),
  };
}
