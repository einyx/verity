import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AiEditPanel from './AiEditPanel';

const original = { hero: { heading: 'Before' } };
const suggested = { hero: { heading: 'After' } };

const createProps = () => ({
  draft: original,
  scope: 'Hero',
  onApply: jest.fn(),
  onClose: jest.fn(),
  generateEdit: jest.fn().mockResolvedValue(suggested),
});

const generate = async () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe the change' }), {
    target: { value: 'Shorten the hero' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  return screen.findByRole('button', { name: 'Apply to draft' });
};

it('reviews a suggestion without changing the draft until Apply is chosen', async () => {
  const props = createProps();
  render(<AiEditPanel {...props} />);
  const apply = await generate();
  expect(screen.getByText('Before', { selector: 'del' })).toBeTruthy();
  expect(screen.getByText('After', { selector: 'ins' })).toBeTruthy();
  expect(props.onApply).not.toHaveBeenCalled();
  fireEvent.click(apply);
  expect(props.onApply).toHaveBeenCalledWith(suggested);
});

it('discards a suggestion without editing the draft', async () => {
  const props = createProps();
  render(<AiEditPanel {...props} />);
  await generate();
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(props.onApply).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Apply to draft' })).toBeNull();
});

it('refuses a stale suggestion after newer manual edits', async () => {
  const props = createProps();
  const { rerender } = render(<AiEditPanel {...props} />);
  const apply = await generate();
  rerender(<AiEditPanel {...props} draft={{ hero: { heading: 'Newer typing' } }} />);
  expect(apply.hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/Draft changed since this suggestion/)).toBeTruthy();
  fireEvent.click(apply);
  expect(props.onApply).not.toHaveBeenCalled();
});

it('preserves the instruction and draft when generation fails', async () => {
  const props = createProps();
  props.generateEdit.mockRejectedValue(new Error('Try again later'));
  render(<AiEditPanel {...props} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe the change' }), {
    target: { value: 'Shorten the hero' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe('Try again later');
  });
  expect(screen.getByDisplayValue('Shorten the hero')).toBeTruthy();
  expect(props.onApply).not.toHaveBeenCalled();
});
