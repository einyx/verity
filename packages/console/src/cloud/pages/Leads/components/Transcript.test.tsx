import { render, screen } from '@testing-library/react';

import Transcript, { type TranscriptProps } from './Transcript';

it('preserves loading, empty and failure copy', () => {
  const { rerender } = render(<Transcript isFailed={false} />);
  expect(screen.getByText('Loading conversation…')).toBeTruthy();
  rerender(<Transcript messages={[]} isFailed={false} />);
  expect(screen.getByText('This conversation has no messages.')).toBeTruthy();
  rerender(<Transcript isFailed messages={[]} />);
  expect(screen.getByText('The conversation could not be loaded.')).toBeTruthy();
});

it('keeps visitor and assistant roles and verbatim message content', () => {
  const props: TranscriptProps = {
    isFailed: false,
    messages: [
      { role: 'user', content: 'Hello\nthere' },
      { role: 'assistant', content: 'Welcome' },
    ],
  };
  render(<Transcript {...props} />);
  expect(screen.getByText('Visitor').parentElement?.className).toContain('messageVisitor');
  expect(screen.getByText('Assistant').parentElement?.className).toContain('messageAssistant');
  expect(screen.getByText('Hello there').textContent).toBe('Hello\nthere');
  expect(screen.getByText('Welcome')).toBeTruthy();
});
