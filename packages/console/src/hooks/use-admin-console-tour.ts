import { adminTenantId } from '@logto/schemas';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';

import styles from './use-admin-console-tour.module.scss';
import useCurrentUser from './use-current-user';

export default function useAdminConsoleTour() {
  const { currentTenantId } = useContext(TenantsContext);
  const { user, isLoaded, customData, updateCustomData } = useCurrentUser();
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console.admin_console_tour' });
  const dismissedUser = useRef('');
  const userId = user?.id;
  const isDone = customData?.consoleTourDone === true;

  useEffect(() => {
    if (
      !isCloud ||
      currentTenantId !== adminTenantId ||
      !isLoaded ||
      !userId ||
      isDone ||
      dismissedUser.current === userId
    ) {
      return;
    }

    const highlights: DriveStep[] = (
      ['sign_in_experience', 'landing_page', 'leads'] as const
    ).flatMap((key) => {
      const element = document.querySelector(`[data-tour="${key}"]`);
      return element
        ? [
            {
              element,
              popover: {
                title: t(`${key}.title`),
                description: t(`${key}.description`),
                side: 'right' as const,
              },
            },
          ]
        : [];
    });
    if (highlights.length === 0) {
      return;
    }

    // Cleanup (including React Strict Mode) must not count as a user dismissal.
    const lifetime = new AbortController();
    const tour = driver({
      animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      disableActiveInteraction: true,
      showProgress: true,
      nextBtnText: t('next'),
      prevBtnText: t('previous'),
      doneBtnText: t('done'),
      closeBtnLabel: t('close'),
      popoverClass: styles.popover,
      steps: [
        { popover: { title: t('welcome.title'), description: t('welcome.description') } },
        ...highlights,
      ],
      onDestroyed: () => {
        if (!lifetime.signal.aborted) {
          // eslint-disable-next-line @silverhand/fp/no-mutation -- Remember dismissal immediately while the profile save is pending.
          dismissedUser.current = userId;
          // eslint-disable-next-line promise/prefer-await-to-then -- Driver teardown is synchronous; persistence must not block it.
          void updateCustomData({ consoleTourDone: true }).catch(() => {
            // Keep the console usable; a failed save allows the tour on the next login.
          });
        }
      },
    });
    tour.drive();
    return () => {
      lifetime.abort();
      tour.destroy();
    };
  }, [currentTenantId, isLoaded, userId, isDone, t, updateCustomData]);
}
