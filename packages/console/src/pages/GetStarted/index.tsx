/* eslint-disable max-lines -- The get-started page is one dashboard of cards; split the cards into their own components before lowering this limit. */
import { ApplicationType, Theme, type Application, type Resource } from '@logto/schemas';
import classNames from 'classnames';
import dayjs from 'dayjs';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import ApiResourceIcon from '@/assets/icons/api-resource.svg?react';
import BookIcon from '@/assets/icons/book.svg?react';
import CheckPreviewDark from '@/assets/icons/check-demo-dark.svg?react';
import CheckPreview from '@/assets/icons/check-demo.svg?react';
import ConnectionIcon from '@/assets/icons/connection.svg?react';
import CreateRoleDark from '@/assets/icons/create-role-dark.svg?react';
import CreateRole from '@/assets/icons/create-role.svg?react';
import ExternalLinkIcon from '@/assets/icons/external-link.svg?react';
import KeyIcon from '@/assets/icons/key.svg?react';
import ShieldIcon from '@/assets/icons/shield.svg?react';
import SocialDark from '@/assets/icons/social-dark.svg?react';
import Social from '@/assets/icons/social.svg?react';
import ApplicationCreation from '@/components/ApplicationCreation';
import { type SelectedGuide } from '@/components/Guide/GuideCard';
import GuideCardGroup from '@/components/Guide/GuideCardGroup';
import { useApiGuideMetadata, useAppGuideMetadata } from '@/components/Guide/hooks';
import PageMeta from '@/components/PageMeta';
import {
  ConnectorsTabs,
  contactEmailLink,
  convertToProductionThresholdDays,
  githubIssuesLink,
} from '@/consts';
import { isCloud } from '@/consts/env';
import { AppDataContext } from '@/contexts/AppDataProvider';
import { TenantsContext } from '@/contexts/TenantsProvider';
import Button, { LinkButton } from '@/ds-components/Button';
import Card from '@/ds-components/Card';
import Spacer from '@/ds-components/Spacer';
import Tag from '@/ds-components/Tag';
import TextLink from '@/ds-components/TextLink';
import { type RequestError } from '@/hooks/use-api';
import { isDevOnlyRegion } from '@/hooks/use-available-regions';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';
import useCurrentUser from '@/hooks/use-current-user';
import useDocumentationUrl from '@/hooks/use-documentation-url';
import useTenantPathname from '@/hooks/use-tenant-pathname';
import useTheme from '@/hooks/use-theme';
import useUserPreferences from '@/hooks/use-user-preferences';
import useWindowResize from '@/hooks/use-window-resize';
import { buildUrl } from '@/utils/url';

import CreateApiForm from '../ApiResources/components/CreateForm';
import ProtectedAppModal from '../Applications/components/ProtectedAppModal';

import ConvertToProductionCard from './ConvertToProductionCard';
import OssCloudUpsell from './OssCloudUpsell';
import styles from './index.module.scss';

// Docs shortcuts shown in the Resources grid. Each path is resolved by `getDocumentationUrl`.
const resourceCards = [
  { key: 'integrate', path: '/integrations', Icon: ConnectionIcon },
  { key: 'sign_in', path: '/docs/recipes/customize-sie/bring-your-ui', Icon: KeyIcon },
  { key: 'rbac', path: '/docs/recipes/rbac/manage-permissions-and-roles', Icon: ShieldIcon },
  { key: 'api', path: '/docs/recipes/interact-with-management-api', Icon: ApiResourceIcon },
] as const;

// Totals come from the first page of each list; only `totalCount` is read.
const applicationsCountUrl = buildUrl('api/applications', [
  ['page', '1'],
  ['page_size', '1'],
]);
const resourcesCountUrl = buildUrl('api/resources', [
  ['page', '1'],
  ['page_size', '1'],
]);

const icons = {
  [Theme.Light]: { PreviewIcon: CheckPreview, SocialIcon: Social, RbacIcon: CreateRole },
  [Theme.Dark]: { PreviewIcon: CheckPreviewDark, SocialIcon: SocialDark, RbacIcon: CreateRoleDark },
};

/** Time-of-day greeting key for the page heading, e.g. "Good morning, Alessio". */
const getGreetingKey = (hour: number) => {
  if (hour < 12) {
    return 'greeting_morning';
  }

  return hour < 18 ? 'greeting_afternoon' : 'greeting_evening';
};

function GetStarted() {
  const {
    access: { canConvertToProduction, isReadOnly },
  } = useCurrentTenantScopes();
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { user } = useCurrentUser();
  const greetingName = user?.name ?? user?.username;
  const { getDocumentationUrl } = useDocumentationUrl();
  const { tenantEndpoint } = useContext(AppDataContext);
  const { currentTenant, isDevTenant } = useContext(TenantsContext);
  const [selectedGuide, setSelectedGuide] = useState<SelectedGuide>();
  const { getStructuredAppGuideMetadata } = useAppGuideMetadata();
  const apiGuideMetadata = useApiGuideMetadata();
  const [showCreateAppForm, setShowCreateAppForm] = useState<boolean>(false);
  const [showCreateApiForm, setShowCreateApiForm] = useState<boolean>(false);
  // The number of visible guide cards to show in one row per the current screen width
  const [visibleCardCount, setVisibleCardCount] = useState(4);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: applicationsData } = useSWR<[Application[], number], RequestError>(
    applicationsCountUrl
  );
  const { data: resourcesData } = useSWR<[Resource[], number], RequestError>(resourcesCountUrl);
  const theme = useTheme();
  const { PreviewIcon, SocialIcon, RbacIcon } = icons[theme];
  const {
    data: userPreferences,
    isLoaded: isUserPreferencesLoaded,
    update: updateUserPreferences,
  } = useUserPreferences();

  useWindowResize(() => {
    const containerWidth = containerRef.current?.clientWidth ?? 0;

    // Responsive breakpoints (1080, 680px) are defined in `GuideCardGroup` component SCSS,
    // and we need to keep them consistent.
    setVisibleCardCount(containerWidth > 1080 ? 4 : containerWidth > 680 ? 3 : 2);
  });

  /**
   * Slice the guide metadata as we only need to show 1 row of guide cards in get-started page
   */
  const featuredAppGuides = useMemo(
    () => getStructuredAppGuideMetadata().featured.slice(0, visibleCardCount),
    [visibleCardCount, getStructuredAppGuideMetadata]
  );

  const onClickAppGuide = useCallback((data: SelectedGuide) => {
    setShowCreateAppForm(true);
    setSelectedGuide(data);
  }, []);

  const onAppCreationCompleted = useCallback(
    (newApp?: Application) => {
      if (newApp && selectedGuide) {
        navigate(`/applications/${newApp.id}/guide/${selectedGuide.id}`, { replace: true });
        return;
      }
      setShowCreateAppForm(false);
      setSelectedGuide(undefined);
    },
    [navigate, selectedGuide]
  );

  const onClickApiGuide = useCallback((data: SelectedGuide) => {
    setShowCreateApiForm(true);
    setSelectedGuide(data);
  }, []);

  const onCloseCreateApiForm = useCallback(
    (newResource?: Resource) => {
      if (newResource && selectedGuide) {
        navigate(`/api-resources/${newResource.id}/guide/${selectedGuide.id}`, { replace: true });
        return;
      }
      setShowCreateApiForm(false);
      setSelectedGuide(undefined);
    },
    [navigate, selectedGuide]
  );

  const shouldShowConvertToProductionCard = useMemo(() => {
    if (
      !isCloud ||
      !isDevTenant ||
      !currentTenant ||
      isDevOnlyRegion(currentTenant.regionName) ||
      !canConvertToProduction
    ) {
      return false;
    }

    const daysSinceCreation = dayjs().diff(dayjs(currentTenant.createdAt), 'day');

    return daysSinceCreation >= convertToProductionThresholdDays;
  }, [isDevTenant, currentTenant, canConvertToProduction]);

  const shouldShowOssCloudUpsell = !isCloud;
  const shouldShowOssCloudBanner =
    shouldShowOssCloudUpsell &&
    isUserPreferencesLoaded &&
    !userPreferences.ossGetStartedCloudUpsellDismissed;

  const persistOssCloudBannerDismissal = useCallback(async () => {
    try {
      await updateUserPreferences({ ossGetStartedCloudUpsellDismissed: true });
    } catch (error: unknown) {
      void error;
    }
  }, [updateUserPreferences]);

  const onDismissOssCloudBanner = useCallback(() => {
    void persistOssCloudBannerDismissal();
  }, [persistOssCloudBannerDismissal]);

  return (
    <div className={styles.container}>
      <PageMeta titleKey="get_started.page_title" />
      <div className={styles.pageHeader}>
        <div className={styles.header}>
          <div className={styles.title}>
            {greetingName
              ? t(`get_started.${getGreetingKey(new Date().getHours())}`, { name: greetingName })
              : t('get_started.title')}
          </div>
          <div className={styles.subtitle}>{t('get_started.subtitle')}</div>
        </div>
        <div className={styles.headerActions}>
          <LinkButton
            title="get_started.header.docs"
            href={getDocumentationUrl('/docs')}
            targetBlank="noopener"
          />
          {!isReadOnly && (
            <LinkButton
              type="primary"
              title="get_started.header.create_app"
              href="/applications/create"
            />
          )}
        </div>
      </div>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('applications.title')}</div>
          <div className={styles.statValue}>{applicationsData?.[1] ?? '–'}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('api_resources.title')}</div>
          <div className={styles.statValue}>{resourcesData?.[1] ?? '–'}</div>
        </div>
      </div>
      <div className={styles.resources}>
        <div className={styles.sectionTitle}>{t('get_started.models.title')}</div>
        <div ref={containerRef} className={styles.modelGrid}>
          {featuredAppGuides.map((guide) => (
            <div key={guide.id} className={styles.modelCard}>
              <div className={styles.modelBand} />
              <div className={styles.modelBody}>
                <div className={styles.resourceTitle}>{guide.metadata.name}</div>
                <div className={styles.resourceDescription}>{guide.metadata.description}</div>
                {!isReadOnly && (
                  <Button
                    title="get_started.models.create"
                    onClick={() => {
                      onClickAppGuide(guide);
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.resources}>
        <div className={styles.sectionTitle}>{t('get_started.resources.title')}</div>
        <div className={styles.resourceGrid}>
          {resourceCards.map(({ key, path, Icon }) => (
            <div key={key} className={styles.resourceCard}>
              <div className={styles.resourceHeader}>
                <div className={styles.resourceIcon}>
                  <Icon />
                </div>
                <div className={styles.resourceTitle}>
                  {t(`get_started.resources.${key}.title`)}
                </div>
              </div>
              <div className={styles.resourceDescription}>
                {t(`get_started.resources.${key}.description`)}
              </div>
              <div className={styles.resourceAction}>
                <LinkButton
                  title={
                    <>
                      <BookIcon className={styles.bookIcon} />
                      <span>{t('get_started.resources.open_docs')}</span>
                    </>
                  }
                  href={getDocumentationUrl(path)}
                  targetBlank="noopener"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      {shouldShowConvertToProductionCard && <ConvertToProductionCard />}
      {shouldShowOssCloudUpsell && (
        <OssCloudUpsell
          isBannerVisible={shouldShowOssCloudBanner}
          onDismissBanner={onDismissOssCloudBanner}
        />
      )}
      {selectedGuide?.metadata.target !== 'API' &&
        selectedGuide?.metadata.target !== ApplicationType.Protected &&
        showCreateAppForm && (
          <ApplicationCreation
            defaultCreateType={selectedGuide?.metadata.target}
            defaultCreateFrameworkName={selectedGuide?.metadata.name}
            onCompleted={onAppCreationCompleted}
          />
        )}
      {selectedGuide?.metadata.target === ApplicationType.Protected && showCreateAppForm && (
        <ProtectedAppModal
          onClose={() => {
            setShowCreateAppForm(false);
            setSelectedGuide(undefined);
          }}
        />
      )}
      <div className={styles.developActions}>
        {!isReadOnly && <TextLink to="/applications/create">{t('get_started.view_all')}</TextLink>}
        {isCloud && (
          <Tag variant="plain" className={styles.mcpTag}>
            <TextLink
              isTrailingIcon
              className={styles.mcpLink}
              href={getDocumentationUrl('/logto-cloud/logto-mcp-server')}
              icon={<ExternalLinkIcon className={styles.mcpLinkIcon} />}
              targetBlank="noopener"
            >
              {t('get_started.develop.try_mcp')}
            </TextLink>
          </Tag>
        )}
      </div>
      <Card className={styles.card}>
        <div className={styles.title}>{t('get_started.customize.title')}</div>
        <div className={styles.borderBox}>
          <div className={styles.rowWrapper}>
            <div className={styles.icon}>
              <PreviewIcon />
            </div>
            <div className={styles.columnWrapper}>
              <div className={styles.title}>{t('get_started.customize.preview.title')}</div>
              <div className={styles.subtitle}>{t('get_started.customize.preview.subtitle')}</div>
            </div>
          </div>
          <Spacer />
          <div className={classNames(styles.rowWrapper, styles.buttons)}>
            <LinkButton
              title="get_started.customize.continue_customizing"
              href="/sign-in-experience"
            />
            <LinkButton
              title="get_started.customize.try_now"
              href={new URL('/demo-app', tenantEndpoint).href}
              targetBlank="noopener"
            />
          </div>
        </div>
        <div className={styles.borderBox}>
          <div className={styles.rowWrapper}>
            <div className={styles.icon}>
              <SocialIcon />
            </div>
            <div className={styles.columnWrapper}>
              <div className={styles.title}>{t('get_started.customize.connector.title')}</div>
              <div className={styles.subtitle}>{t('get_started.customize.connector.subtitle')}</div>
            </div>
          </div>
          <Spacer />
          {!isReadOnly && (
            <LinkButton
              title="get_started.customize.add_more"
              href={`/connectors/${ConnectorsTabs.Social}`}
            />
          )}
        </div>
      </Card>
      <Card className={styles.card}>
        <div className={styles.title}>{t('get_started.secure.title')}</div>
        <GuideCardGroup
          hasCardBorder
          hasCardButton
          guides={apiGuideMetadata}
          onClickGuide={onClickApiGuide}
        />
        {showCreateApiForm && <CreateApiForm onClose={onCloseCreateApiForm} />}
        {!isReadOnly && <TextLink to="/api-resources/create">{t('get_started.view_all')}</TextLink>}
      </Card>
      <Card className={styles.card}>
        <div className={styles.title}>{t('get_started.manage.title')}</div>
        <div className={styles.borderBox}>
          <div className={styles.rowWrapper}>
            <div className={styles.icon}>
              <RbacIcon />
            </div>
            <div className={styles.columnWrapper}>
              <div className={styles.title}>{t('get_started.manage.rbac.title')}</div>
              <div className={styles.subtitle}>{t('get_started.manage.rbac.subtitle')}</div>
            </div>
          </div>
          <Spacer />
          {!isReadOnly && <LinkButton title="get_started.manage.create_roles" href="/roles" />}
        </div>
      </Card>
      <div className={styles.footerLinks}>
        <TextLink href={contactEmailLink}>{t('get_started.footer.help')}</TextLink>
        <TextLink href={githubIssuesLink} targetBlank="noopener">
          {t('get_started.footer.feedback')}
        </TextLink>
      </div>
    </div>
  );
}

export default GetStarted;
/* eslint-enable max-lines */
