import { useTranslation } from 'react-i18next';

import useTenantPathname from '@/hooks/use-tenant-pathname';

import { useSidebarMenuItems } from './hook';
import { getPath } from './utils';

/** Use the same permission-filtered metadata for navigation and the workspace breadcrumb. */
export default function useShellNavigation() {
  const { sections } = useSidebarMenuItems();
  const { match } = useTenantPathname();
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const visibleSections = sections
    .map((section) => ({
      ...section,
      label: t(`tab_sections.${section.title}`),
      items: section.items
        .filter((item) => !item.isHidden)
        .map((item) => ({ ...item, label: t(`tabs.${item.title}`) })),
    }))
    .filter(({ items }) => items.length > 0);
  const active = visibleSections
    .flatMap((section) => section.items.map((item) => ({ section, item })))
    .filter(
      ({ item }) =>
        !item.modal && !item.externalLink && match(`/${item.path ?? getPath(item.title)}`)
    )
    .slice()
    .sort(
      (left, right) =>
        (right.item.path ?? getPath(right.item.title)).length -
        (left.item.path ?? getPath(left.item.title)).length
    )[0];

  return { sections: visibleSections, active };
}
