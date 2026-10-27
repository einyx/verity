import { TenantRole } from '@logto/schemas';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactModal from 'react-modal';

import FormField from '@/ds-components/FormField';
import ModalLayout from '@/ds-components/ModalLayout';
import Select from '@/ds-components/Select';

import useTenantRoleOptions from '@/pages/TenantSettings/TenantMembers/use-tenant-role-options';

type Props = {
  readonly isOpen: boolean;
  readonly email: string;
  readonly isLoading: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (role: TenantRole) => void;
};

/**
 * Asks which role the person gets in the tenant before the onboarding mail goes out. The role is
 * the one the invitation carries, so it can only be chosen here.
 */
function SendOnboardingEmailModal({ isOpen, email, isLoading, onClose, onConfirm }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const [role, setRole] = useState<TenantRole>(TenantRole.Collaborator);
  const roleOptions = useTenantRoleOptions();

  return (
    <ReactModal isOpen={isOpen} className="modal-container">
      <ModalLayout
        title="user_details.onboarding_email_title"
        subtitle="user_details.onboarding_email_description"
        onClose={onClose}
        footer={
          <div className="modal-footer">
            <button
              type="button"
              className="button plain"
              disabled={isLoading}
              onClick={onClose}
            >
              {t('general.cancel')}
            </button>
            <button
              type="button"
              className="button primary"
              disabled={isLoading}
              onClick={() => {
                onConfirm(role);
              }}
            >
              {t('user_details.onboarding_email_send')}
            </button>
          </div>
        }
      >
        <p>{email}</p>
        <FormField title="tenant_members.roles">
          <Select
            value={role}
            options={roleOptions}
            onChange={(value) => {
              if (value) {
                setRole(value);
              }
            }}
          />
        </FormField>
      </ModalLayout>
    </ReactModal>
  );
}

export default SendOnboardingEmailModal;
