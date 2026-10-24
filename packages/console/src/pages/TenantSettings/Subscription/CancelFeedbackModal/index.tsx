import { useState } from 'react';
import ReactModal from 'react-modal';

import Button from '@/ds-components/Button';
import FormField from '@/ds-components/FormField';
import ModalLayout from '@/ds-components/ModalLayout';
import Textarea from '@/ds-components/Textarea';
import modalStyles from '@/scss/modal.module.scss';

type Props = {
  readonly isOpen: boolean;
  /** The SKU the tenant was subscribed to before the cancellation. */
  readonly onClose: () => void;
};

function CancelFeedbackModal({ isOpen, onClose }: Props) {
  const [whatMadeYouCancel, setWhatMadeYouCancel] = useState('');
  const [howToReconsider, setHowToReconsider] = useState('');

  const cancelReason = whatMadeYouCancel.trim();
  const reconsiderSuggestion = howToReconsider.trim();

  const closeModal = () => {
    onClose();
  };

  const skip = () => {
    closeModal();
  };

  const submit = () => {
    closeModal();
  };

  return (
    <ReactModal
      isOpen={isOpen}
      className={modalStyles.content}
      overlayClassName={modalStyles.overlay}
      onRequestClose={skip}
    >
      <ModalLayout
        title="subscription.cancel_feedback_modal.title"
        subtitle="subscription.cancel_feedback_modal.description"
        footer={
          <Button
            size="large"
            type="primary"
            title="general.submit"
            disabled={!cancelReason && !reconsiderSuggestion}
            onClick={submit}
          />
        }
        onClose={skip}
      >
        <FormField title="subscription.cancel_feedback_modal.what_made_you_cancel">
          <Textarea
            rows={4}
            value={whatMadeYouCancel}
            onChange={({ currentTarget: { value } }) => {
              setWhatMadeYouCancel(value);
            }}
          />
        </FormField>
        <FormField title="subscription.cancel_feedback_modal.how_to_reconsider">
          <Textarea
            rows={4}
            value={howToReconsider}
            onChange={({ currentTarget: { value } }) => {
              setHowToReconsider(value);
            }}
          />
        </FormField>
      </ModalLayout>
    </ReactModal>
  );
}

export default CancelFeedbackModal;
