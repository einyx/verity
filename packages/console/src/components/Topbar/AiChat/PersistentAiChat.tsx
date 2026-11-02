import { Theme, type ChatScope } from '@logto/schemas';
import classNames from 'classnames';
import {
  type ComponentProps,
  type ReactNode,
  type RefCallback,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Modal from 'react-modal';

import AskAiIconDark from '@/assets/icons/logto-ai-bot-dark.svg?react';
import AskAiIcon from '@/assets/icons/logto-ai-bot.svg?react';
import useTheme from '@/hooks/use-theme';

import '@/components/LandingChat/demo-chat.css';
import AiWorkspace from './AiWorkspace';
import SessionControls from './SessionControls';
import SessionDraft from './SessionDraft';
import SessionFeedback from './SessionFeedback';
import SessionSidebar from './SessionSidebar';
import SessionTabs from './SessionTabs';
import SessionWorkspaceRuntime from './SessionWorkspaceRuntime';
import SetupBanner from './SetupBanner';
import styles from './index.module.scss';
import { type SessionApi } from './session-api';
import { sessionTabsKey } from './session-tabs';
import useChatSessions from './use-chat-sessions';
import workspaceStyles from './workspace.module.scss';

const iconMap = { [Theme.Light]: <AskAiIcon />, [Theme.Dark]: <AskAiIconDark /> } satisfies Record<
  Theme,
  ReactNode
>;

const focusWorkspace = () => {
  const dialog = document.querySelector('[role="dialog"]');
  const tab = dialog?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
  const history = dialog?.querySelector<HTMLButtonElement>('[aria-controls="chat-history"]');
  const newChat = dialog?.querySelector<HTMLButtonElement>('nav button');
  (tab ?? (history?.getClientRects().length ? history : newChat))?.focus();
};

function AccountWorkspace({
  scope,
  api,
  className,
  isCompact = false,
  isSidebar = false,
}: {
  readonly scope?: ChatScope;
  readonly api: SessionApi;
  readonly className?: string;
  readonly isCompact?: boolean;
  readonly isSidebar?: boolean;
}) {
  const icon = iconMap[useTheme()];
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [threadHost, setThreadHost] = useState<HTMLDivElement>();
  const threadRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
    setThreadHost(element ?? undefined);
  }, []);
  const trigger = useRef<HTMLButtonElement>(null);
  const { controller, state } = useChatSessions({ scope, api, visible });
  const active = state.records[state.activeId ?? ''];
  const close = () => {
    setVisible(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setVisible((open) => !open);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => {
      window.removeEventListener('keydown', shortcut);
    };
  }, []);
  useEffect(() => {
    if (!visible || !controller) {
      return;
    }
    const timer = setTimeout(() => {
      void controller.list(archived, search);
    }, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [visible, controller, archived, search]);
  const appElement = document.querySelector<HTMLElement>('#app');
  const modal = (thread?: ReactNode) => (
    <Modal
      shouldCloseOnOverlayClick
      isOpen={visible}
      ariaHideApp={Boolean(appElement)}
      appElement={appElement ?? undefined}
      contentLabel={t('inkeep_ai_bot.ask_ai_label')}
      className={workspaceStyles.modal}
      overlayClassName={workspaceStyles.overlay}
      onRequestClose={close}
    >
      {controller ? (
        <AiWorkspace
          panelId={state.activeId ? `chat-panel-${state.activeId}` : undefined}
          panelLabelId={state.activeId ? `chat-tab-${state.activeId}` : undefined}
          hasMessages={Boolean(active?.messages.length)}
          isLoading={Boolean(active?.running)}
          setup={<SetupBanner icon={icon} />}
          history={
            <SessionSidebar
              activeId={state.activeId}
              sessions={state.history}
              search={search}
              isArchived={archived}
              isLoading={state.loading}
              nextCursor={state.nextCursor}
              onSearch={setSearch}
              onArchived={setArchived}
              onNew={() => {
                setArchived(false);
                setSearch('');
                void (async () => {
                  const id = await controller.newSession();
                  if (id) {
                    await controller.flush(id);
                  }
                })();
              }}
              onOpen={(id) => {
                void controller.openSession(id);
              }}
              onMore={() => {
                void controller.list(archived, search, true);
              }}
            />
          }
          tabs={
            <SessionTabs
              openSessions={state.openIds.flatMap((id) => {
                const record = state.records[id];
                return record
                  ? [
                      {
                        id,
                        title: record.session.title,
                        running: record.running,
                        attention: ['failed', 'conflict'].includes(record.saveState),
                      },
                    ]
                  : [];
              })}
              activeId={state.activeId}
              onSelect={(id) => {
                controller.selectSession(id);
              }}
              onClose={(id) => {
                controller.closeTab(id);
                requestAnimationFrame(focusWorkspace);
              }}
            />
          }
          title={
            active && (
              <SessionControls
                key={active.session.id}
                session={active.session}
                isBusy={active.running || Boolean(active.operation)}
                onChange={(input) => {
                  void (async () => {
                    await controller.change(active.session.id, input);
                    if (input.archived) {
                      requestAnimationFrame(focusWorkspace);
                    }
                  })();
                }}
                onRemove={() => {
                  void (async () => {
                    await controller.remove(active.session.id);
                    requestAnimationFrame(focusWorkspace);
                  })();
                }}
              />
            )
          }
          composer={
            <>
              <SessionFeedback
                controller={controller}
                state={state}
                search={search}
                isArchived={archived}
              />
              <SessionDraft controller={controller} sessionId={state.activeId} />
            </>
          }
          thread={
            <section className={workspaceStyles.sessionTranscript}>
              {active?.messageCursor && (
                <button
                  type="button"
                  onClick={() => {
                    if (state.activeId) {
                      void controller.older(state.activeId);
                    }
                  }}
                >
                  Load earlier messages
                </button>
              )}
              {thread}
            </section>
          }
          onClose={close}
          onPromptSelected={(prompt) => {
            controller.setText(prompt);
          }}
        />
      ) : (
        <>
          <p role="status">Sign in to load your private conversations.</p>
          <button type="button" onClick={close}>
            Close Ask AI
          </button>
        </>
      )}
    </Modal>
  );
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={t('inkeep_ai_bot.ask_ai_label')}
        title="Ask AI about MeshX (⌘K)"
        className={classNames(styles.askAiButton, isSidebar && styles.sidebarTrigger, className)}
        onClick={() => {
          setVisible(true);
        }}
      >
        {icon}
        {!isCompact && <span className={styles.askAiLabel}>{t('inkeep_ai_bot.ask_ai_label')}</span>}
        {!isCompact && <kbd className={styles.shortcut}>⌘K</kbd>}
      </button>
      {controller &&
        Object.values(state.records).map(
          (record) =>
            record && (
              <SessionWorkspaceRuntime
                key={record.session.id}
                controller={controller}
                record={record}
                api={api}
              >
                {record.session.id === state.activeId && threadHost
                  ? (thread) => createPortal(thread, threadHost)
                  : undefined}
              </SessionWorkspaceRuntime>
            )
        )}
      {modal(<div ref={threadRef} className={workspaceStyles.sessionThread} />)}
    </>
  );
}

/** Remount presentation state too: even title searches and attachment errors are account-private. */
export default function PersistentAiChat(props: ComponentProps<typeof AccountWorkspace>) {
  return (
    <AccountWorkspace key={props.scope ? sessionTabsKey(props.scope) : 'signed-out'} {...props} />
  );
}
