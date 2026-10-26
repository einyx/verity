import classNames from 'classnames';
import { adminTenantId } from '@logto/schemas';
import { useContext, useEffect, startTransition, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useSWRConfig } from 'swr';

import InvitationIcon from '@/assets/icons/invitation.svg?react';
import MembersIcon from '@/assets/icons/members.svg?react';
import PlusIcon from '@/assets/icons/plus.svg?react';
import { TenantSettingsTabs } from '@/consts';
import { isCloud } from '@/consts/env';
import Button from '@/ds-components/Button';
import Spacer from '@/ds-components/Spacer';
import { TenantsContext } from '@/contexts/TenantsProvider';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import InviteMemberModal from './InviteMemberModal';
import styles from './index.module.scss';
import useTenantMembersApi from './use-tenant-members-api';

function TenantMembers() {
  const { navigate, match } = useTenantPathname();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const {
    access: { canInviteMember, canRemoveMember },
  } = useCurrentTenantScopes();
  const { currentTenantId } = useContext(TenantsContext);
  // Cloud mode provisions admin-tenant operators directly: the self-host invitation
  // routes answer 404 there, so the invitations tab is only for workspace tenants.
  const isAdminTenant = currentTenantId === adminTenantId;

  const membersPath = `/tenant-settings/${TenantSettingsTabs.Members}`;
  const invitationsPath = `${membersPath}/invitations`;

  const isInvitationTab = match(invitationsPath);

  const { invitationsKey } = useTenantMembersApi();
  const { mutate } = useSWRConfig();

  useEffect(() => {
    // If someone lands on the invitations route of the admin tenant, send them back to members.
    if (isAdminTenant && isInvitationTab) {
      navigate(membersPath);
    }
  }, [isAdminTenant, isInvitationTab, navigate, membersPath]);

  return (
    <div className={styles.container}>
      {(canInviteMember || (!isCloud && canRemoveMember)) && !isAdminTenant && (
        <div className={styles.tabButtons}>
          <Button
            className={classNames(styles.button, !isInvitationTab && styles.active)}
            icon={<MembersIcon />}
            title="tenant_members.members"
            onClick={() => {
              void navigate(membersPath);
            }}
          />
          <Button
            className={classNames(styles.button, isInvitationTab && styles.active)}
            icon={<InvitationIcon />}
            title="tenant_members.invitations"
            onClick={() => {
              void navigate(invitationsPath);
            }}
          />
          <Spacer />
          {canInviteMember && (
            <Button
              type="primary"
              size="large"
              icon={<PlusIcon />}
              title="tenant_members.invite_members"
              onClick={() => {
                setShowInviteModal(true);
              }}
            />
          )}
        </div>
      )}
      <Outlet />
      {canInviteMember && (
        <InviteMemberModal
          isOpen={showInviteModal}
          onClose={(isSuccessful) => {
            setShowInviteModal(false);

            if (!isSuccessful) {
              return;
            }

            // Refresh the shared cache even before the invitations list mounts.
            void mutate(invitationsKey);

            if (isInvitationTab) {
              return;
            }

            // Defer navigation to avoid modal closing render being interrupted
            startTransition(() => {
              void navigate(invitationsPath);
            });
          }}
        />
      )}
    </div>
  );
}

export default TenantMembers;
