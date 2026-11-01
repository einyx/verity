import { useLogto } from '@logto/react';
import { Theme } from '@logto/schemas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAccountCenterSettings } from '@ac/apis/account-center';
import { getSignInExperienceSettings } from '@ac/apis/sign-in-experience';
import { getUserInfo } from '@ac/apis/user';
import useApi from '@ac/hooks/use-api';
import { changeLanguage, getPreferredLanguage } from '@ac/i18n/utils';
import { getUiLocales } from '@ac/utils/account-center-route';
import { getThemeBySystemPreference, subscribeToSystemTheme } from '@ac/utils/theme';

import type { PageContextType } from './PageContext';
import PageContext from './PageContext';
import {
  clearVerificationRecord,
  getStoredVerificationId,
  persistVerificationRecord,
} from './verification-storage';

type Props = {
  readonly children: React.ReactNode;
};

const getInitialTheme = () => {
  if (document.documentElement.dataset.theme === Theme.Dark) {
    return Theme.Dark;
  }

  return Theme.Light;
};

const getInitialPlatform = (): PageContextType['platform'] =>
  document.body.classList.contains('mobile') ? 'mobile' : 'web';

const PageContextProvider = ({ children }: Props) => {
  const { isAuthenticated } = useLogto();
  const getUserInfoRequest = useApi(getUserInfo, { silent: true });
  const [theme, setTheme] = useState(getInitialTheme);
  const [toast, setToast] = useState('');
  const [experienceSettings, setExperienceSettings] =
    useState<PageContextType['experienceSettings']>(undefined);
  const [accountCenterSettings, setAccountCenterSettings] =
    useState<PageContextType['accountCenterSettings']>(undefined);
  const [userInfo, setUserInfo] = useState<PageContextType['userInfo']>(undefined);
  const [userInfoError, setUserInfoError] = useState<Error>();
  const [isLoadingUserInfo, setIsLoadingUserInfo] = useState(false);
  const [verificationId, setVerificationId] = useState<string>();
  const [isLoadingExperience, setIsLoadingExperience] = useState(true);
  const [experienceError, setExperienceError] = useState<Error>();
  const settingsRequestPending = useRef(false);
  const isMounted = useRef(true);

  const loadUserInfo = useCallback(
    async ({
      clearOnError = false,
      showLoading = false,
      syncError = false,
    }: {
      clearOnError?: boolean;
      showLoading?: boolean;
      syncError?: boolean;
    } = {}) => {
      if (showLoading) {
        setIsLoadingUserInfo(true);
      }

      const [error, data] = await getUserInfoRequest();

      if (error || !data) {
        if (syncError) {
          setUserInfoError(
            error instanceof Error ? error : new Error('Failed to load user information.')
          );
        }

        if (clearOnError) {
          setUserInfo(undefined);
        }

        if (showLoading) {
          setIsLoadingUserInfo(false);
        }

        return;
      }

      setUserInfo(data);
      setUserInfoError(undefined);

      if (showLoading) {
        setIsLoadingUserInfo(false);
      }
    },
    [getUserInfoRequest]
  );

  const refreshUserInfo = useCallback(async () => {
    await loadUserInfo();
  }, [loadUserInfo]);

  useEffect(() => {
    const storedVerificationId = getStoredVerificationId();

    if (storedVerificationId) {
      setVerificationId(storedVerificationId);
    }
  }, []);

  const setVerificationIdCallback = useCallback((id?: string, expiresAt?: string) => {
    setVerificationId(id);

    if (!id || !expiresAt) {
      clearVerificationRecord();
      return;
    }

    persistVerificationRecord({
      verificationId: id,
      expiresAt,
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setUserInfo(undefined);
      setUserInfoError(undefined);
      setIsLoadingUserInfo(false);
      return;
    }

    void loadUserInfo({
      clearOnError: true,
      showLoading: true,
      syncError: true,
    });
  }, [isAuthenticated, loadUserInfo]);

  const reloadSettings = useCallback(async () => {
    if (settingsRequestPending.current) {
      return;
    }
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Deduplicate explicit retries synchronously, before React renders.
    settingsRequestPending.current = true;
    setIsLoadingExperience(true);

    try {
      const [settings, accountCenter] = await Promise.all([
        getSignInExperienceSettings(),
        getAccountCenterSettings(),
      ]);
      await changeLanguage(
        getPreferredLanguage({
          languageSettings: settings.languageInfo,
          uiLocales: getUiLocales(),
        })
      );
      if (!isMounted.current) {
        return;
      }
      setExperienceSettings(settings);
      setAccountCenterSettings(accountCenter);
      setExperienceError(undefined);
    } catch (error: unknown) {
      if (!isMounted.current) {
        return;
      }
      setExperienceError(
        error instanceof Error ? error : new Error('Failed to load sign-in experience settings.')
      );
    } finally {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Release the per-provider request lock after settlement.
      settingsRequestPending.current = false;
      if (isMounted.current) {
        setIsLoadingExperience(false);
      }
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- React StrictMode can replay effect setup after cleanup.
    isMounted.current = true;
    void reloadSettings();
    return () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Ignore completion after provider unmount.
      isMounted.current = false;
    };
  }, [reloadSettings]);

  useEffect(() => {
    if (!experienceSettings) {
      return;
    }

    if (!experienceSettings.color.isDarkModeEnabled) {
      setTheme(Theme.Light);
      return;
    }

    const updateTheme = () => {
      setTheme(getThemeBySystemPreference());
    };

    updateTheme();
    const unsubscribe = subscribeToSystemTheme(updateTheme);

    return () => {
      unsubscribe();
    };
  }, [experienceSettings]);

  const platform = getInitialPlatform();

  const value = useMemo<PageContextType>(
    () => ({
      theme,
      toast,
      platform,
      setTheme,
      setToast,
      experienceSettings,
      setExperienceSettings,
      accountCenterSettings,
      setAccountCenterSettings,
      userInfo,
      refreshUserInfo,
      userInfoError,
      isLoadingUserInfo,
      verificationId,
      setVerificationId: setVerificationIdCallback,
      isLoadingExperience,
      experienceError,
      reloadSettings,
    }),
    [
      accountCenterSettings,
      experienceError,
      reloadSettings,
      experienceSettings,
      isLoadingExperience,
      platform,
      refreshUserInfo,
      theme,
      toast,
      userInfo,
      userInfoError,
      isLoadingUserInfo,
      verificationId,
      setVerificationIdCallback,
    ]
  );

  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
};

export default PageContextProvider;
