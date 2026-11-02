import { type ChatScope } from '@logto/schemas';
import { z } from 'zod/v3';

export type SessionTabsState = { openIds: string[]; activeId: string | undefined };
const storedTabs = z.object({ openIds: z.unknown().array(), activeId: z.unknown().optional() });
export const sessionTabsKey = ({ tenantId, userId }: ChatScope) =>
  `ask-ai-tabs:${JSON.stringify([tenantId, userId])}`;

/** Browser storage contains preferences only, never titles, transcripts, drafts or credentials. */
export const readSessionTabs = (value: ReturnType<Storage['getItem']>): SessionTabsState => {
  try {
    const parsed = storedTabs.parse(JSON.parse(value ?? '{}'));
    const openIds = [
      ...new Set(
        parsed.openIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128
        )
      ),
    ].slice(0, 200);
    return {
      openIds,
      activeId:
        typeof parsed.activeId === 'string' && openIds.includes(parsed.activeId)
          ? parsed.activeId
          : openIds[0],
    };
  } catch {
    return { openIds: [], activeId: undefined };
  }
};

export const closeSessionTab = (tabs: SessionTabsState, id: string): SessionTabsState => {
  const index = tabs.openIds.indexOf(id);
  const openIds = tabs.openIds.filter((openId) => openId !== id);
  return {
    openIds,
    activeId: tabs.activeId === id ? openIds[Math.min(index, openIds.length - 1)] : tabs.activeId,
  };
};
