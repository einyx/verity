import { RoleType, type Role } from '@logto/schemas';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactModal from 'react-modal';
import useSWR from 'swr';

import FormField from '@/ds-components/FormField';
import ModalLayout from '@/ds-components/ModalLayout';
import Select from '@/ds-components/Select';
import { type RequestError } from '@/hooks/use-api';
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
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const { data } = useSWR<[Role[], number], RequestError>(
    buildUrl('api/roles', { page: '1', page_size: '20', type: RoleType.User })
  );
  const roleOptions = (data?.[0] ?? []).map((role) => ({ value: role.id, title: role.name }));

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
                onConfirm(roleIds);
              }}
            >
              {t('user_details.onboarding_email_send')}
            </button>
          </div>
        }
      >
        <p>{email}</p>
        <FormField title="user_details.roles">
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
