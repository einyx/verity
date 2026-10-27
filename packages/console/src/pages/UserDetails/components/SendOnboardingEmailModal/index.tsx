import { RoleType, type Role } from '@logto/schemas';
import classNames from 'classnames';
import { useState } from 'react';
import ReactModal from 'react-modal';
import useSWR from 'swr';

import Button from '@/ds-components/Button';
import DangerousRaw from '@/ds-components/DangerousRaw';
import FormField from '@/ds-components/FormField';
import ModalLayout from '@/ds-components/ModalLayout';
import Select from '@/ds-components/Select';
import { type RequestError } from '@/hooks/use-api';
import modalStyles from '@/scss/modal.module.scss';
import { buildUrl } from '@/utils/url';

type Props = {
  readonly isOpen: boolean;
  readonly email: string;
  readonly isLoading: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (roleIds: string[]) => void;
};

/**
 * Asks which roles the person gets before the onboarding mail goes out. The mail carries a sign-in
 * link, and the roles are granted once it is out.
 */
function SendOnboardingEmailModal({ isOpen, email, isLoading, onClose, onConfirm }: Props) {
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const { data } = useSWR<[Role[], number], RequestError>(
    buildUrl('api/roles', { page: '1', page_size: '20', type: RoleType.User })
  );
  const roleOptions = (data?.[0] ?? []).map((role) => ({ value: role.id, title: role.name }));

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
        onClose={onClose}
        footer={
          <>
            <Button title="general.cancel" onClick={onClose} />
            <Button
              type="primary"
              title="user_details.onboarding_email_send"
              disabled={isLoading}
              onClick={() => {
                onConfirm(roleIds);
              }}
            />
          </>
        }
      >
        <p>{email}</p>
        <FormField
          title="tenant_members.roles"
          description={
            <DangerousRaw>
              Everyone who gets this mail can sign in to the console. The role decides what they can
              do: <strong>user</strong> is a member, <strong>admin</strong> manages the console, and{' '}
              <strong>default:admin</strong> manages the default tenant.
            </DangerousRaw>
          }
        >
          <Select
            value={roleIds[0]}
            options={roleOptions}
            onChange={(value) => {
              setRoleIds(value ? [value] : []);
            }}
          />
        </FormField>
      </ModalLayout>
    </ReactModal>
  );
}

export default SendOnboardingEmailModal;
