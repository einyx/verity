import type { AdminConsoleKey } from '@logto/phrases';
import { Theme } from '@logto/schemas';

import CalendarDark from '@/assets/icons/calendar-dark.svg?react';
import Calendar from '@/assets/icons/calendar.svg?react';
import EmailDark from '@/assets/icons/email-dark.svg?react';
import Email from '@/assets/icons/email.svg?react';
import GithubDark from '@/assets/icons/github-dark.svg?react';
import Github from '@/assets/icons/github.svg?react';
import { contactEmailLink, githubIssuesLink, slackLink } from '@/consts';
import useTheme from '@/hooks/use-theme';

import { parseContactBookingUrl } from './booking-url';

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
  const bookingUrl = parseContactBookingUrl(import.meta.env.VITE_CONTACT_BOOKING_URL);

  return [
    ...(bookingUrl
      ? [
          {
            title: 'contact.reserve.title' as const,
            icon: isLightMode ? Calendar : CalendarDark,
            description: 'contact.reserve.description' as const,
            label: 'contact.reserve.button' as const,
            link: bookingUrl,
          },
        ]
      : []),
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
