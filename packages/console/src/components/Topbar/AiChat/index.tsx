import { Theme } from '@logto/schemas';
import classNames from 'classnames';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from 'react-modal';

import CopyIcon from '@/assets/icons/copy.svg?react';
import AskAiIconDark from '@/assets/icons/logto-ai-bot-dark.svg?react';
import AskAiIcon from '@/assets/icons/logto-ai-bot.svg?react';
import Button from '@/ds-components/Button';
import useTheme from '@/hooks/use-theme';
import { onKeyDownHandler } from '@/utils/a11y';

import Composer, { type Attachment } from './Composer';
import Conversation, { type ConversationApi } from './Conversation';
import SetupBanner from './SetupBanner';
import Thread from './Thread';
import { readAttachments } from './attachments';
import styles from './index.module.scss';

type Props = {
  readonly className?: string;
};

const iconMap = Object.freeze({
  [Theme.Light]: <AskAiIcon />,
  [Theme.Dark]: <AskAiIconDark />,
} satisfies Record<Theme, ReactNode>);

function AiChat({ className }: Props) {
  const theme = useTheme();
  const Icon = iconMap[theme];
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [conversation, setConversation] = useState<ConversationApi>();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [transcript, setTranscript] = useState('');
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });

  // The send button is enabled once there is text or an attachment.
  const hasContent = Boolean(input.trim()) || attachments.length > 0;

  const exampleQuestions = t('inkeep_ai_bot.example_questions', {
    returnObjects: true,
  });

  // Cloudflare-style shortcut: ⌘K (Ctrl+K on Windows/Linux) opens the assistant from anywhere.
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
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

  const sendMessage = (question?: string) => {
    const typed = (question ?? input).trim();

    if ((!typed && attachments.length === 0) || isLoading || !conversation) {
      return;
    }

    // File contents travel inside the message, since the chat API only takes text.
    const fileBlocks = attachments.map(
      ({ name, text }) => `${t('inkeep_ai_bot.file_label', { name })}\n\`\`\`\n${text}\n\`\`\``
    );

    conversation.send([...fileBlocks, typed].filter(Boolean).join('\n\n'));
    setHasMessages(true);
    setInput('');
    setAttachments([]);
    setAttachmentError(undefined);
  };

  // Clearing remounts the runtime through `key`, which drops the old messages with it.
  const startOver = () => {
    setSession((current) => current + 1);
    setConversation(undefined);
    setHasMessages(false);
    setIsLoading(false);
    setTranscript('');
    setInput('');
    setAttachments([]);
    setAttachmentError(undefined);
  };

  const copyChat = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
    } catch {
      // Clipboard access can be blocked by the browser. The copy button just stays inactive.
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  return (
    <Conversation
      key={session}
      onReady={setConversation}
      onRunStateChange={setIsLoading}
      onTranscript={(text) => {
        setTranscript(text);
        setHasMessages(true);
      }}
    >
      <div
        tabIndex={0}
        aria-label={t('inkeep_ai_bot.ask_ai_label')}
        title="Ask AI about MeshX (⌘K)"
        role="button"
        className={classNames(styles.askAiButton, className)}
        onClick={() => {
          setIsModalOpen(true);
        }}
        onKeyDown={onKeyDownHandler(() => {
          setIsModalOpen(true);
        })}
      >
        {Icon}
        {t('inkeep_ai_bot.ask_ai_label')}
        <kbd className={styles.shortcut}>⌘K</kbd>
      </div>
      <Modal
        shouldCloseOnOverlayClick
        isOpen={isModalOpen}
        ariaHideApp={false}
        contentLabel={t('inkeep_ai_bot.ask_ai_label')}
        className={classNames(styles.modal, styles.modalExpanded)}
        overlayClassName={styles.overlay}
        onRequestClose={closeModal}
      >
        <SetupBanner icon={Icon} />
        <Thread icon={Icon} />
        {!hasMessages && Array.isArray(exampleQuestions) && (
          <div className={styles.demoIdeas}>
            <div className={styles.demoIdeasLabel}>
              {t('inkeep_ai_bot.example_questions_label')}
            </div>
            {exampleQuestions.map((question) => (
              <button
                key={question}
                type="button"
                className={styles.demoIdea}
                onClick={() => {
                  sendMessage(question);
                }}
              >
                {question}
              </button>
            ))}
          </div>
        )}
        <Composer
          value={input}
          attachments={attachments}
          attachmentError={attachmentError}
          isLoading={isLoading}
          hasContent={hasContent}
          onChange={setInput}
          onSubmit={() => {
            sendMessage();
          }}
          onFilesSelected={(files) => {
            void addFiles(files);
          }}
          onQuickAction={(prompt) => {
            setInput(prompt);
          }}
          onRemoveAttachment={(id) => {
            setAttachments((current) => current.filter((item) => item.id !== id));
          }}
        />
        <div className={styles.toolbar}>
          <div className={styles.toolbarActions}>
            <Button
              size="small"
              type="text"
              title="inkeep_ai_bot.clear"
              disabled={!hasMessages}
              onClick={startOver}
            />
            <Button
              size="small"
              type="text"
              title="inkeep_ai_bot.copy_chat"
              icon={<CopyIcon />}
              disabled={!hasMessages}
              onClick={() => {
                void copyChat();
              }}
            />
          </div>
          <span className={styles.disclaimer} title={t('inkeep_ai_bot.disclaimer_tooltip')}>
            {t('inkeep_ai_bot.disclaimer_label')}
          </span>
        </div>
      </Modal>
    </Conversation>
  );
}

export default AiChat;
