import { builtInLanguageOptions as consoleBuiltInLanguageOptions } from '@logto/phrases';
import { Theme } from '@logto/schemas';
import { isKeyInObject, trySafe } from '@silverhand/essentials';
import classNames from 'classnames';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ContactIcon from '@/assets/icons/contact-us.svg?react';
import CubeIcon from '@/assets/icons/cube.svg?react';
import DocumentIcon from '@/assets/icons/document-nav-button.svg?react';
import Globe from '@/assets/icons/globe.svg?react';
import meshxWordmarkDark from '@/assets/images/meshx-wordmark-dark.png';
import meshxWordmark from '@/assets/images/meshx-wordmark.png';
import { githubReleasesLink } from '@/consts';
import { isCloud } from '@/consts/env';
import Dropdown, { DropdownItem } from '@/ds-components/Dropdown';
import Spacer from '@/ds-components/Spacer';
import TextLink from '@/ds-components/TextLink';
import useDocumentationUrl from '@/hooks/use-documentation-url';
import useTenantPathname from '@/hooks/use-tenant-pathname';
import useTheme from '@/hooks/use-theme';
import useUserPreferences from '@/hooks/use-user-preferences';
import { onKeyDownHandler } from '@/utils/a11y';

import AiChat from './AiChat';
import ContactModal from './ContactModal';
import EnterpriseSubscriptions from './EnterpriseSubscriptions';
import TenantSelector from './TenantSelector';
import UserInfo from './UserInfo';
import styles from './index.module.scss';
import { currentVersion, isGreaterThanCurrentVersion } from './utils';

type Props = {
  readonly className?: string;
  /* eslint-disable react/boolean-prop-naming */
  readonly hideTenantSelector?: boolean;
  readonly hideTitle?: boolean;
  /* eslint-enable react/boolean-prop-naming */
};

function Topbar({ className, hideTenantSelector, hideTitle }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const theme = useTheme();

  return (
    <div className={classNames(styles.topbar, className)}>
      <div
        className={styles.brand}
        role="button"
        tabIndex={0}
        onClick={() => {
          navigate('/');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            navigate('/');
          }
        }}
      >
        {/* The wordmark is black on a light page, and white on a dark one. */}
        <img
          className={styles.wordmark}
          src={theme === Theme.Dark ? meshxWordmarkDark : meshxWordmark}
          alt="meshX"
        />
      </div>
      {isCloud && !hideTenantSelector && <TenantSelector />}
      {!isCloud && !hideTitle && (
        <>
          <div className={styles.line} />
          <div className={styles.text}>{t('title')}</div>
        </>
      )}
      <Spacer />
      {isCloud && <AiChat />}
      {isCloud && <EnterpriseSubscriptions className={styles.button} />}
      <LanguageButton />
      <DocumentButton />
      <HelpButton />
      {!isCloud && <VersionButton />}
      <UserInfo />
    </div>
  );
}

export default Topbar;

/** Globe button that switches the console language. It saves the choice the same way as the user menu. */
function LanguageButton() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const {
    data: { language },
    update,
  } = useUserPreferences();

  return (
    <>
      <div
        ref={anchorRef}
        tabIndex={0}
        className={styles.button}
        role="button"
        aria-label={t('menu.language')}
        title={t('menu.language')}
        onKeyDown={onKeyDownHandler(() => {
          setIsOpen(true);
        })}
        onClick={() => {
          setIsOpen(true);
        }}
      >
        <Globe className={styles.icon} />
      </div>
      <Dropdown
        hasOverflowContent
        anchorRef={anchorRef}
        isOpen={isOpen}
        horizontalAlign="end"
        onClose={() => {
          setIsOpen(false);
        }}
      >
        {consoleBuiltInLanguageOptions.map(({ value, title }) => (
          <DropdownItem
            key={value}
            onClick={() => {
              void update({ language: value });
              setIsOpen(false);
            }}
          >
            {title}
            {value === language ? ' ✓' : ''}
          </DropdownItem>
        ))}
      </Dropdown>
    </>
  );
}

function DocumentButton() {
  const { documentationSiteUrl } = useDocumentationUrl();
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  return (
    <TextLink
      href={documentationSiteUrl}
      targetBlank="noopener"
      className={styles.button}
      aria-label={t('topbar.docs')}
      title={t('topbar.docs')}
      icon={<DocumentIcon className={styles.icon} />}
    />
  );
}

function HelpButton() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const [isContactOpen, setIsContactOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div
        ref={anchorRef}
        tabIndex={0}
        className={styles.button}
        role="button"
        aria-label={t('topbar.help')}
        title={t('topbar.help')}
        onKeyDown={onKeyDownHandler(() => {
          setIsContactOpen(true);
        })}
        onClick={() => {
          setIsContactOpen(true);
        }}
      >
        <ContactIcon className={styles.icon} />
      </div>
      <ContactModal
        isOpen={isContactOpen}
        onCancel={() => {
          setIsContactOpen(false);
        }}
      />
    </>
  );
}

function VersionButton() {
  const [isNewVersionAvailable, setIsNewVersionAvailable] = useState(false);

  useEffect(() => {
    void trySafe(
      async () => {
        const response = await fetch('https://numbers.logto.io/pull.json');
        const json = await response.json();
        if (
          !isKeyInObject(json, 'latestRelease') ||
          typeof json.latestRelease !== 'string' ||
          !json.latestRelease.startsWith('v')
        ) {
          return;
        }
        if (isGreaterThanCurrentVersion(json.latestRelease)) {
          setIsNewVersionAvailable(true);
        }
      },
      (error) => {
        console.warn('Failed to check for new version', error);
      }
    );
  }, []);

  return (
    <TextLink
      href={githubReleasesLink}
      targetBlank="noopener"
      className={styles.button}
      icon={<CubeIcon className={styles.icon} />}
    >
      v{currentVersion}
      {isNewVersionAvailable && <div className={styles.newVersionDot} />}
    </TextLink>
  );
}
