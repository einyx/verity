import { Theme } from '@logto/schemas';
import classNames from 'classnames';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from 'react-modal';

import CloseIcon from '@/assets/icons/close.svg?react';
import AskAiIconDark from '@/assets/icons/logto-ai-bot-dark.svg?react';
import AskAiIcon from '@/assets/icons/logto-ai-bot.svg?react';
import { isDevFeaturesEnabled } from '@/consts/env';
import useTheme from '@/hooks/use-theme';
import { onKeyDownHandler } from '@/utils/a11y';

import '@/components/LandingChat/demo-chat.css';
import AiWorkspaceRuntime from './AiWorkspaceRuntime';
import Composer, { type Attachment } from './Composer';
import Conversation, { type ConversationApi } from './Conversation';
import SetupBanner from './SetupBanner';
import Thread from './Thread';
import { readAttachments } from './attachments';
import styles from './index.module.scss';
import workspaceStyles from './workspace.module.scss';

type Props = {
  readonly className?: string;
  readonly isCompact?: boolean;
  readonly isSidebar?: boolean;
};

const iconMap = Object.freeze({
  [Theme.Light]: <AskAiIcon />,
  [Theme.Dark]: <AskAiIconDark />,
} satisfies Record<Theme, ReactNode>);

function AiChat({ className, isCompact = false, isSidebar = false }: Props) {
  const theme = useTheme();
  const Icon = iconMap[theme];
  const [isModalOpen, setIsModalOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [conversation, setConversation] = useState<ConversationApi>();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const appElement = document.querySelector<HTMLElement>('#app');

  // The send button is enabled once there is text or an attachment.
  const hasContent = Boolean(input.trim()) || attachments.length > 0;

  // Cloudflare-style shortcut: ⌘K (Ctrl+K on Windows/Linux) opens the assistant from anywhere.
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsModalOpen((isOpen) => !isOpen);
      }
    };

    window.addEventListener('keydown', handleShortcut);

    return () => {
      window.removeEventListener('keydown', handleShortcut);
    };
  }, []);

  const addFiles = async (files: File[]) => {
    const { added, rejected } = await readAttachments(files);

    setAttachmentError(
      rejected.length === 0
        ? undefined
        : t('inkeep_ai_bot.attachment_error', { names: rejected.join(', ') })
    );

    setAttachments((current) => [...current, ...added]);
  };

  const sendMessage = () => {
    const typed = input.trim();

    if ((!typed && attachments.length === 0) || isLoading || !conversation) {
      return;
    }

    // File contents travel inside the message, since the chat API only takes text.
    const fileBlocks = attachments.map(
      ({ name, text }) => `${t('inkeep_ai_bot.file_label', { name })}\n\`\`\`\n${text}\n\`\`\``
    );

    conversation.send([...fileBlocks, typed].filter(Boolean).join('\n\n'));
    setInput('');
    setAttachments([]);
    setAttachmentError(undefined);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    triggerRef.current?.focus();
  };

  const composer = (
    <Composer
      value={input}
      attachments={attachments}
      attachmentError={attachmentError}
      isLoading={isLoading}
      hasContent={hasContent}
      onChange={setInput}
      onSubmit={sendMessage}
      onFilesSelected={(files) => {
        void addFiles(files);
      }}
      onRemoveAttachment={(id) => {
        setAttachments((current) => current.filter((item) => item.id !== id));
      }}
    />
  );

  return (
    <Conversation onReady={setConversation} onRunStateChange={setIsLoading}>
      <div
        ref={triggerRef}
        tabIndex={0}
        aria-label={t('inkeep_ai_bot.ask_ai_label')}
        title="Ask AI about MeshX (⌘K)"
        role="button"
        className={classNames(styles.askAiButton, isSidebar && styles.sidebarTrigger, className)}
        onClick={() => {
          setIsModalOpen(true);
        }}
        onKeyDown={onKeyDownHandler(() => {
          setIsModalOpen(true);
        })}
      >
        {Icon}
        {!isCompact && <span className={styles.askAiLabel}>{t('inkeep_ai_bot.ask_ai_label')}</span>}
        {!isCompact && <kbd className={styles.shortcut}>⌘K</kbd>}
      </div>
      {/* The expanded Ask AI workspace keeps the current console page mounted underneath. */}
      <Modal
        shouldCloseOnOverlayClick
        isOpen={isModalOpen}
        ariaHideApp={isDevFeaturesEnabled && Boolean(appElement)}
        appElement={appElement ?? undefined}
        contentLabel={t('inkeep_ai_bot.ask_ai_label')}
        className={
          isDevFeaturesEnabled
            ? workspaceStyles.modal
            : classNames('demo-chat-dialog', styles.demoModal)
        }
        overlayClassName={isDevFeaturesEnabled ? workspaceStyles.overlay : styles.overlay}
        onRequestClose={closeModal}
      >
        {isDevFeaturesEnabled ? (
          <AiWorkspaceRuntime
            isLoading={isLoading}
            composer={composer}
            thread={<Thread />}
            setup={<SetupBanner icon={Icon} />}
            onClose={closeModal}
            onPromptSelected={(prompt) => {
              setInput(prompt);
              document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')?.focus();
            }}
          />
        ) : (
          <>
            <button
              type="button"
              className={workspaceStyles.close}
              aria-label="Close Ask AI"
              onClick={closeModal}
            >
              <CloseIcon aria-hidden />
            </button>
            <SetupBanner icon={Icon} />
            <Thread />
            {composer}
          </>
        )}
      </Modal>
    </Conversation>
  );
}

export default AiChat;
