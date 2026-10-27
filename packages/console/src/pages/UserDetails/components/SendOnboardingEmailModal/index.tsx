import { TenantRole, getTenantRole } from '@logto/schemas';
import classNames from 'classnames';
import { useState } from 'react';
import ReactModal from 'react-modal';

import Button from '@/ds-components/Button';
import DangerousRaw from '@/ds-components/DangerousRaw';
import FormField from '@/ds-components/FormField';
import ModalLayout from '@/ds-components/ModalLayout';
import Select from '@/ds-components/Select';
import modalStyles from '@/scss/modal.module.scss';

type Props = {
  readonly isOpen: boolean;
  readonly email: string;
  readonly isLoading: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (roleName: string) => void;
};

/** The roles a person can have in a tenant, with what each of them allows. */
const roleOptions = [TenantRole.Admin, TenantRole.Collaborator, TenantRole.Viewer].map((role) => ({
  value: role,
  title: getTenantRole(role).description,
}));

/**
 * Asks which role the person gets before the onboarding mail goes out. The mail carries a sign-in
 * link, and the role is granted once it is out.
 */
function SendOnboardingEmailModal({ isOpen, email, isLoading, onClose, onConfirm }: Props) {
  const [roleName, setRoleName] = useState<string>(TenantRole.Admin);

  return (
    <ReactModal
      shouldCloseOnEsc
      isOpen={isOpen}
      className={classNames(modalStyles.content)}
      overlayClassName={classNames(modalStyles.overlay)}
      onRequestClose={onClose}
    >
      <ModalLayout
        title="user_details.onboarding_email_title"
        subtitle="user_details.onboarding_email_description"
        footer={
          <>
            <Button title="general.cancel" onClick={onClose} />
            <Button
              type="primary"
              title="user_details.onboarding_email_send"
              disabled={isLoading}
              onClick={() => {
                onConfirm(roleName);
              }}
            />
          </>
        }
        onClose={onClose}
      >
        <p>{email}</p>
        <FormField
          title="tenant_members.roles"
          description={
            <DangerousRaw>
              The role decides what the person can do in the tenant. Their access to the Console
              comes with the mail.
            </DangerousRaw>
          }
        >
          <Select
            value={roleName}
            options={roleOptions}
            onChange={(value) => {
              setRoleName(value ?? TenantRole.Admin);
            }}
          />
        </FormField>
      </ModalLayout>
    </ReactModal>
  );
}

export default SendOnboardingEmailModal;
