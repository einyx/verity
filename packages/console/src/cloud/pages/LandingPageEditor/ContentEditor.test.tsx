import { fireEvent, render, screen } from '@testing-library/react';

import ContentEditor from './ContentEditor';

it('lets editors add and remove repeatable object cards within the collection limits', () => {
  const value: unknown = {
    cards: [{ title: 'First', body: 'First body' }],
  };
  const onChange = jest.fn<void, [unknown]>();
  const { rerender } = render(<ContentEditor label="Section" value={value} onChange={onChange} />);

  fireEvent.click(screen.getByRole('button', { name: 'Add cards' }));
  rerender(
    <ContentEditor label="Section" value={onChange.mock.calls.at(-1)?.[0]} onChange={onChange} />
  );
  expect(screen.getAllByRole('textbox', { name: 'Text' })).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Remove cards 2' }));
  rerender(
    <ContentEditor label="Section" value={onChange.mock.calls.at(-1)?.[0]} onChange={onChange} />
  );
  expect(screen.getAllByRole('textbox', { name: 'Text' })).toHaveLength(1);
});
