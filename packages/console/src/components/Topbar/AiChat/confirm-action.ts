type ActionIdentity = { id: string; tool: string };

/** A confirmed landing-page save must refresh the editor, never publish or overwrite local state. */
export const confirmChatAction = async (
  action: ActionIdentity,
  confirm: (id: string) => Promise<unknown>,
  refreshLandingEditor: () => Promise<unknown>
) => {
  await confirm(action.id);
  if (action.tool !== 'save_landing_page_draft') {
    return;
  }
  try {
    await refreshLandingEditor();
  } catch {
    // Saving already succeeded. SWR exposes a refresh error in the editor without losing its draft.
  }
};
