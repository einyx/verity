import type { AdminConsoleKey } from '@logto/phrases';
import { Theme } from '@logto/schemas';

import EmailDark from '@/assets/icons/email-dark.svg?react';
import Email from '@/assets/icons/email.svg?react';
import GithubDark from '@/assets/icons/github-dark.svg?react';
import Github from '@/assets/icons/github.svg?react';
import { contactEmailLink, githubIssuesLink, slackLink } from '@/consts';
import useTheme from '@/hooks/use-theme';

type ContactItem = {
  icon: SvgComponent;
  title: AdminConsoleKey;
  description: AdminConsoleKey;
  label: AdminConsoleKey;
  link: string;
};

export const useContacts = (): ContactItem[] => {
  const theme = useTheme();
  const isLightMode = theme === Theme.Light;

  return [
    {
      title: 'contact.slack.title',
      icon: isLightMode ? Email : EmailDark,
      description: 'contact.slack.description',
      label: 'contact.slack.button',
      link: slackLink,
    },
    {
      title: 'contact.github.title',
      icon: isLightMode ? Github : GithubDark,
      description: 'contact.github.description',
      label: 'contact.github.button',
      link: githubIssuesLink,
    },
    {
      title: 'contact.email.title',
      icon: isLightMode ? Email : EmailDark,
      description: 'contact.email.description',
      label: 'contact.email.button',
      link: contactEmailLink,
    },
  ];
};
