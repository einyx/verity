import { type ChatScope } from '@logto/schemas';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { type SessionApi } from './session-api';
import { SessionController } from './session-controller';
import { type SessionSnapshot } from './session-state';
import { sessionTabsKey } from './session-tabs';

const empty: SessionSnapshot = {
  records: {},
  history: [],
  nextCursor: null,
  emptyDraft: { text: '', attachments: [], revision: 0 },
  openIds: [],
  activeId: undefined,
  loading: false,
};
const emptySnapshot = () => empty;
const unsubscribeEmpty = () => false;
const subscribeEmpty = () => unsubscribeEmpty;

export default function useChatSessions({
  scope,
  api,
  visible,
}: {
  scope?: ChatScope;
  api: SessionApi;
  visible: boolean;
}) {
  const key = scope ? sessionTabsKey(scope) : undefined;
  const tenantId = scope?.tenantId;
  const userId = scope?.userId;
  const [owned, setOwned] = useState<{ key: string; controller: SessionController }>();
  useEffect(() => {
    if (!tenantId || !userId || !key) {
      setOwned(undefined);
      return;
    }
    if (owned?.key === key && !owned.controller.isDisposed) {
      owned.controller.updateApi(api);
      return;
    }
    const controller = new SessionController({ tenantId, userId }, api, window.localStorage);
    setOwned({ key, controller });
  }, [key, tenantId, userId, api, owned]);
  useEffect(
    () => () => {
      owned?.controller.dispose();
    },
    [owned]
  );
  const controller = owned?.key === key ? owned?.controller : undefined;
  const state = useSyncExternalStore(
    controller?.subscribe ?? subscribeEmpty,
    controller?.getSnapshot ?? emptySnapshot
  );
  useEffect(() => {
    if (!visible || !controller) {
      return;
    }
    const refresh = () => {
      void controller.list();
      for (const id of controller.getSnapshot().openIds) {
        void controller.refresh(id);
      }
      void controller.poll();
    };
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void controller.poll();
      }
    }, 2000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [visible, controller]);
  return { controller, state };
}
