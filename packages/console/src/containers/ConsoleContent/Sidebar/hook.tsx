import { adminTenantId } from '@logto/schemas';
import { type Optional } from '@silverhand/essentials';
import type { TFuncKey } from 'i18next';
import { useContext } from 'react';
import type { FC, ReactNode } from 'react';

import { isCloud, isDevFeaturesEnabled } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import useIsActionsEnabled from '@/hooks/use-is-actions-enabled';

import { menuIcons } from './menu-icons';

type SidebarItem = {
  Icon: FC;
  title: TFuncKey<'translation', 'admin_console.tabs'>;
  isHidden?: boolean;
  modal?: (isOpen: boolean, onCancel: () => void) => ReactNode;
  externalLink?: string;
  path?: string;
};

type SidebarSection = {
  title: TFuncKey<'translation', 'admin_console.tab_sections'>;
  isHidden?: boolean;
  items: SidebarItem[];
};

const findFirstItem = (sections: SidebarSection[]): Optional<SidebarItem> => {
  for (const section of sections) {
    const found = section.items.find((item) => !item.isHidden);

    if (found) {
      return found;
    }
  }
};

export const useSidebarMenuItems = (): {
  sections: SidebarSection[];
  firstItem: Optional<SidebarItem>;
} => {
  const isActionsEnabled = useIsActionsEnabled();
  const { currentTenantId } = useContext(TenantsContext);
  const allSections: SidebarSection[] = [
    {
      title: 'overview',
      items: [
        {
          Icon: menuIcons.get_started,
          title: 'get_started',
        },
        {
          Icon: menuIcons.dashboard,
          title: 'dashboard',
        },
      ],
    },
    {
      title: 'authentication',
      items: [
        {
          Icon: menuIcons.applications,
          title: 'applications',
        },

        {
          Icon: menuIcons.sign_in_experience,
          title: 'sign_in_experience',
          path: 'sign-in-experience',
        },
        {
          Icon: menuIcons.mfa,
          title: 'mfa',
        },
        {
          Icon: menuIcons.connectors,
          title: 'connectors',
        },
        {
          Icon: menuIcons.enterprise_sso,
          title: 'enterprise_sso',
        },
        {
          Icon: menuIcons.security,
          title: 'security',
        },
      ],
    },
    {
      title: 'infrastructure',
      items: [
        {
          Icon: menuIcons.stacks,
          title: 'stacks',
          path: 'infrastructure',
        },
        {
          Icon: menuIcons.capacity,
          title: 'capacity',
          path: 'infrastructure/capacity',
        },
        {
          Icon: menuIcons.agent,
          title: 'agent',
          path: 'infrastructure/agent',
        },
        {
          Icon: menuIcons.bundle,
          title: 'bundle',
          path: 'infrastructure/bundle',
        },
        {
          Icon: menuIcons.mcp_servers,
          title: 'mcp_servers',
          path: 'mcp-portal',
        },
      ],
    },
    {
      title: 'authorization',
      items: [
        {
          Icon: menuIcons.api_resources,
          title: 'api_resources',
        },
        {
          Icon: menuIcons.roles,
          title: 'roles',
        },
        {
          Icon: menuIcons.organization_template,
          title: 'organization_template',
        },
      ],
    },
    {
      title: 'users',
      items: [
        {
          Icon: menuIcons.organizations,
          title: 'organizations',
        },
        {
          Icon: menuIcons.users,
          title: 'users',
        },
      ],
    },
    {
      title: 'developer',
      items: [
        {
          Icon: menuIcons.actions,
          title: 'actions',
          path: 'actions',
          // Actions are still under development and should be released as one feature.
          isHidden: !isActionsEnabled,
        },
        {
          Icon: menuIcons.customize_jwt,
          title: 'customize_jwt',
        },
        {
          Icon: menuIcons.webhooks,
          title: 'webhooks',
        },
        {
          Icon: menuIcons.audit_logs,
          title: 'audit_logs',
        },
      ],
    },
    {
      title: 'tenant',
      items: [
        {
          Icon: menuIcons.get_started,
          title: 'landing_page',
          path: 'landing-page',
          // Landing page CMS for the marketing site. Dev feature, Cloud only, admin tenant only.
          isHidden: !(isCloud && isDevFeaturesEnabled && currentTenantId === adminTenantId),
        },
        {
          Icon: menuIcons.get_started,
          title: 'leads',
          path: 'leads',
          // Leads from the landing demo chat. Cloud only, admin tenant only.
          isHidden: !(isCloud && currentTenantId === adminTenantId),
        },
        {
          Icon: menuIcons.tenant_settings,
          title: 'tenant_access',
          path: 'tenant-access',
          // Who may manage customer tenants. Cloud only, admin tenant only.
          isHidden: !(isCloud && currentTenantId === adminTenantId),
        },
        {
          Icon: menuIcons.tenant_settings,
          title: 'tenant_settings',
        },
      ],
    },
  ];

  // The admin tenant is the instance's own console, not a Foundation workspace. Its sidebar leaves out
  // the Foundation and authorization sections and the items that do not apply to it.
  const isAdminTenant = currentTenantId === adminTenantId;
  const adminHiddenItems = new Set(['get_started', 'webhooks', 'customize_jwt', 'organizations']);
  const adminHiddenSections = new Set(['infrastructure', 'authorization']);
  const enabledSections = allSections
    .filter((section) => !section.isHidden)
    .filter((section) => !(isAdminTenant && adminHiddenSections.has(section.title)))
    .map((section) =>
      isAdminTenant && (section.title === 'overview' || section.title === 'developer')
        ? { ...section, items: section.items.filter((item) => !adminHiddenItems.has(item.title)) }
        : section
    );

  return { sections: enabledSections, firstItem: findFirstItem(enabledSections) };
};
