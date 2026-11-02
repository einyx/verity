import { fireEvent, render, screen } from '@testing-library/react';

import AiWorkspace from './AiWorkspace';

const props = {
  hasMessages: false,
  isLoading: false,
  composer: <textarea aria-label="Message" />,
  thread: <p>Real transcript</p>,
  setup: <button type="button">Set up your agent</button>,
  onPromptSelected: jest.fn(),
  onClose: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
});

it('shows one conversation hierarchy, a calm welcome and functional prompts', () => {
  render(<AiWorkspace {...props} />);
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(screen.getByRole('heading', { name: 'What shall we work on?' })).toBeTruthy();
  expect(screen.queryByText('Chats and tasks')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review workspace templates' }));
  expect(props.onPromptSelected).toHaveBeenCalledWith(
    'Compare Foundation, Dashboards AI, Foundation AI, and V1 workspace templates. Do not create anything yet.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('switches to the transcript without remounting or clearing the composer', () => {
  const { rerender } = render(<AiWorkspace {...props} />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: 'Keep this draft' } });
  rerender(<AiWorkspace {...props} hasMessages />);
  expect(screen.queryByRole('heading', { name: 'What shall we work on?' })).toBeNull();
  expect(screen.getByText('Real transcript')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input);
  expect(input).toHaveProperty('value', 'Keep this draft');
});

it('keeps task shortcuts from submitting another request while generation is running', () => {
  render(<AiWorkspace {...props} isLoading />);
  const button = screen.getByRole('button', { name: 'Investigate sign-in issues' });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.click(button);
  expect(props.onPromptSelected).not.toHaveBeenCalled();
});

it('discloses history only on request and preserves the composer through dismissal', () => {
  render(
    <AiWorkspace {...props} history={<button type="button">Synthetic conversation</button>} />
  );
  const composer = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(composer, { target: { value: 'Unsent synthetic draft' } });
  expect(screen.queryByRole('dialog', { name: 'Conversation history' })).toBeNull();
  const trigger = screen.getByRole('button', { name: 'History' });
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Conversation history' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Synthetic conversation' }), {
    key: 'Escape',
    keyCode: 27,
  });
  expect(screen.queryByRole('dialog', { name: 'Conversation history' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(composer);
  expect(composer).toHaveProperty('value', 'Unsent synthetic draft');
});

it('history selection dismisses the temporary view without invoking New chat or closing Ask AI', () => {
  const onNew = jest.fn();
  const onSelect = jest.fn();
  render(
    <AiWorkspace
      {...props}
      history={(dismiss) => (
        <button
          type="button"
          onClick={() => {
            onSelect('synthetic');
            dismiss();
          }}
        >
          Synthetic archived conversation
        </button>
      )}
      onNew={onNew}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic archived conversation' }));
  expect(onSelect).toHaveBeenCalledWith('synthetic');
  expect(onNew).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Conversation history' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'History' }));
});
