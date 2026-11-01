import { adminTenantId, OrganizationInvitationStatus } from '@logto/schemas';
import classNames from 'classnames';
import { useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import KeyboardArrowDown from '@/assets/icons/keyboard-arrow-down.svg?react';
import PlusSign from '@/assets/icons/plus.svg?react';
import { type TenantResponse } from '@/cloud/types/router';
import CreateTenantModal from '@/components/CreateTenantModal';
import TenantEnvTag from '@/components/TenantEnvTag';
import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import Divider from '@/ds-components/Divider';
import Dropdown from '@/ds-components/Dropdown';
import OverlayScrollbar from '@/ds-components/OverlayScrollbar';
import Tag from '@/ds-components/Tag';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';
import useUserDefaultTenantId from '@/hooks/use-user-default-tenant-id';
import useUserInvitations from '@/hooks/use-user-invitations';
import { onKeyDownHandler } from '@/utils/a11y';

import TenantDropdownItem from './TenantDropdownItem';
import TenantInvitationDropdownItem from './TenantInvitationDropdownItem';
import styles from './index.module.scss';

// The admin tenant is the console's own tenant, so it is shown as "Admin" instead of its stored name.
const getTenantLabel = (tenant: TenantResponse) =>
  tenant.id === adminTenantId ? 'Admin' : tenant.name;

type Props = {
  readonly isCompact?: boolean;
  readonly isCollapsed?: boolean;
};

export default function TenantSelector(props: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  // OSS has no cloud tenant/invitation API or switcher. Keep its real console identity.
  if (!isCloud) {
    return (
      <div className={styles.ossScope} title={t('title')}>
        {props.isCollapsed ? 'm' : t('title')}
      </div>
    );
  }
  return <CloudTenantSelector {...props} />;
}

function CloudTenantSelector({ isCompact = false, isCollapsed = false }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const {
    tenants,
    prependTenant,
    currentTenant: currentTenantInfo,
    currentTenantId,
    navigateTenant,
  } = useContext(TenantsContext);
  const { data: pendingInvitations } = useUserInvitations(OrganizationInvitationStatus.Pending);
  const {
    access: { isReadOnly },
  } = useCurrentTenantScopes();

  const anchorRef = useRef<HTMLDivElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCreateTenantModal, setShowCreateTenantModal] = useState(false);
  const { updateDefaultTenantId } = useUserDefaultTenantId();

  // The admin tenant is listed after the customer tenants, separated by a divider.
  const adminTenant = tenants.find((tenant) => tenant.id === adminTenantId);
  const customerTenants = tenants.filter((tenant) => tenant.id !== adminTenantId);

  if (tenants.length === 0 || !currentTenantInfo) {
    return null;
  }

  const accessibleLabel = [
    getTenantLabel(currentTenantInfo),
    currentTenantInfo.id !== adminTenantId && t(`tenants.full_env_tag.${currentTenantInfo.tag}`),
    isReadOnly && t('tenants.view_only.tag'),
    Boolean(pendingInvitations?.length) && `${pendingInvitations?.length} pending invitations`,
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <>
      <div
        ref={anchorRef}
        tabIndex={0}
        className={classNames(
          styles.currentTenantCard,
          isCompact && styles.compact,
          isCollapsed && styles.collapsed
        )}
        role="button"
        aria-label={accessibleLabel}
        aria-haspopup="menu"
        aria-expanded={showDropdown}
        title={getTenantLabel(currentTenantInfo)}
        onKeyDown={onKeyDownHandler(() => {
          setShowDropdown(true);
        })}
        onClick={() => {
          setShowDropdown(true);
        }}
      >
        {isCompact && (
          <span aria-hidden className={styles.avatar}>
            {getTenantLabel(currentTenantInfo).slice(0, 2)}
          </span>
        )}
        <div className={styles.name}>{getTenantLabel(currentTenantInfo)}</div>
        <TenantEnvTag tag={currentTenantInfo.tag} />
        {isReadOnly && (
          <Tag size="small" className={styles.viewOnlyTag}>
            {t('tenants.view_only.tag')}
          </Tag>
        )}
        {Boolean(pendingInvitations?.length) && <div className={styles.redDot} />}
        <KeyboardArrowDown className={styles.arrowIcon} />
      </div>
      <Dropdown
        hasOverflowContent
        isFocusManaged
        className={styles.dropdown}
        anchorRef={anchorRef}
        isOpen={showDropdown}
        horizontalAlign="start"
        onClose={() => {
          setShowDropdown(false);
          anchorRef.current?.focus();
        }}
      >
        <OverlayScrollbar className={styles.scrollableContent}>
          {customerTenants.map((tenantData) => (
            <TenantDropdownItem
              key={tenantData.id}
              tenantData={{ ...tenantData, name: getTenantLabel(tenantData) }}
              isSelected={tenantData.id === currentTenantId}
              onClick={() => {
                navigateTenant(tenantData.id);
                void updateDefaultTenantId(tenantData.id);
                setShowDropdown(false);
              }}
            />
          ))}
          {adminTenant && (
            <>
              <Divider />
              <TenantDropdownItem
                key={adminTenant.id}
                tenantData={{ ...adminTenant, name: getTenantLabel(adminTenant) }}
                isSelected={adminTenant.id === currentTenantId}
                onClick={() => {
                  navigateTenant(adminTenant.id);
                  void updateDefaultTenantId(adminTenant.id);
                  setShowDropdown(false);
                }}
              />
            </>
          )}
          {pendingInvitations?.map((invitation) => (
            <TenantInvitationDropdownItem key={invitation.id} data={invitation} />
          ))}
        </OverlayScrollbar>
        <Divider />
        <button
          tabIndex={0}
          className={styles.createTenantButton}
          onClick={() => {
            setShowCreateTenantModal(true);
          }}
          onKeyDown={onKeyDownHandler(() => {
            setShowCreateTenantModal(true);
          })}
        >
          <div>{t('cloud.tenant.create_tenant')}</div>
          <PlusSign />
        </button>
      </Dropdown>
      <CreateTenantModal
        isOpen={showCreateTenantModal}
        onClose={async (tenant?: TenantResponse) => {
          setShowCreateTenantModal(false);
          if (tenant) {
            prependTenant(tenant);
            navigateTenant(tenant.id);
          }
        }}
      />
    </>
  );
}
