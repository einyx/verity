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

it('shows a task rail, calm welcome and functional prompts rather than fake history', () => {
  render(<AiWorkspace {...props} />);
  expect(screen.getByRole('complementary', { name: 'Ask AI tasks' })).toBeTruthy();
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
  render(<AiWorkspace {...props} hasMessages isLoading />);
  const button = screen.getByRole('button', { name: 'Investigate sign-ins' });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.click(button);
  expect(props.onPromptSelected).not.toHaveBeenCalled();
});
