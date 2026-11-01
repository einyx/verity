import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import FollowUpEmailReview from './FollowUpEmailReview';

const props = {
  recipient: 'alex@example.com',
  initialText: 'Hi Alex,\n\nThanks for your interest.\n\nThe MeshX team',
  onClose: jest.fn(),
};

it('requires review and a final Send click, with the exact edited message and stable request key', async () => {
  const onSend = jest.fn(async (_body: unknown) => ({
    status: 'accepted' as const,
    requestId: 'mail-1',
  }));
  render(<FollowUpEmailReview {...props} onSend={onSend} />);
  expect(screen.getByLabelText('Recipient')).toHaveProperty('readOnly', true);
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Demo follow-up' } });
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Hi Alex,\n\nA reviewed paragraph.\n\nThe MeshX team' },
  });
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  expect(onSend).not.toHaveBeenCalled();
  const send = screen.getByRole('button', { name: 'Send email' });
  fireEvent.click(send);
  fireEvent.click(send);
  await waitFor(() => {
    expect(screen.getByText(/Submitted to the email service/)).toBeTruthy();
  });
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend.mock.calls[0]?.[0]).toMatchObject({
    subject: 'Demo follow-up',
    text: 'Hi Alex,\n\nA reviewed paragraph.\n\nThe MeshX team',
    confirmed: true,
  });
  expect(onSend.mock.calls[0]?.[0]).toHaveProperty('idempotencyKey', expect.any(String));
});

it('blocks unresolved signature placeholders instead of sending them', () => {
  render(
    <FollowUpEmailReview {...props} initialText="Best regards, [Your Name]" onSend={jest.fn()} />
  );
  expect(screen.getByRole('button', { name: 'Review email' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/Replace the sender placeholders/)).toBeTruthy();
});

it('does not automatically retry an uncertain provider outcome', async () => {
  const onSend = jest.fn(async () => {
    throw new Error('Unknown outcome');
  });
  render(<FollowUpEmailReview {...props} onSend={onSend} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain('Check before sending another email');
  });
  expect(screen.queryByRole('button', { name: 'Send email' })).toBeNull();
  expect(onSend).toHaveBeenCalledTimes(1);
});
