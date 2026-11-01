import { defaultLandingPageContent } from '@logto/schemas';
import { fireEvent, render, screen } from '@testing-library/react';

import ProposedActionCard, { type ProposedAction } from './ProposedActionCard';

jest.mock('@/consts/env', () => ({ isDevFeaturesEnabled: true }));

afterEach(() => {
  jest.restoreAllMocks();
});

const action: ProposedAction = {
  id: 'proposal',
  tool: 'save_landing_page_draft',
  body: defaultLandingPageContent,
  expiresAt: '2026-11-01T12:00:00Z',
  status: 'pending',
};

it('shows a rendered landing-page artifact instead of raw draft JSON', () => {
  render(<ProposedActionCard action={action} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  const frame = screen.getByTitle('Proposed landing page preview');
  expect(frame.getAttribute('src')).toBe(
    `${window.location.origin}/console/landing-preview?cmsPreview=1`
  );
  expect(frame.getAttribute('sandbox')).not.toContain('allow-forms');
  expect(screen.queryByText(/"sections":/)).toBeNull();
  expect(
    screen.getByText('Preview only. Save a draft to update the editor; publishing is separate.')
  ).toBeTruthy();
});

it('expands a preview and selects sections without saving or publishing', () => {
  const confirm = jest.fn();
  const cancel = jest.fn();
  render(<ProposedActionCard action={action} onConfirm={confirm} onCancel={cancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Expand preview' }));
  expect(screen.getByRole('button', { name: 'Collapse preview' })).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(confirm).toHaveBeenCalledTimes(1);
});

it('does not render invalid model output in a preview or offer to save it', () => {
  render(
    <ProposedActionCard
      action={{ ...action, body: { html: '<script>bad()</script>' } }}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />
  );
  expect(screen.queryByTitle('Proposed landing page preview')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('sends a validated draft only to the trusted preview window and never reacts to foreign messages', () => {
  render(<ProposedActionCard action={action} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  const frame = screen.getByTitle('Proposed landing page preview');
  if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) {
    throw new Error('Missing preview window');
  }
  const post = jest.spyOn(frame.contentWindow, 'postMessage');
  fireEvent.load(frame);
  expect(post).toHaveBeenCalledWith(
    { type: 'meshx-cms-draft', doc: defaultLandingPageContent },
    window.location.origin
  );
  post.mockClear();
  fireEvent(
    window,
    new MessageEvent('message', {
      origin: 'https://elsewhere.example',
      source: frame.contentWindow,
      data: { type: 'meshx-cms-ready' },
    })
  );
  expect(post).not.toHaveBeenCalled();
});

it('keeps the existing proposal card when artifact previews are disabled', () => {
  const flags = jest.requireMock<{ isDevFeaturesEnabled: boolean }>('@/consts/env');
  jest.replaceProperty(flags, 'isDevFeaturesEnabled', false);
  render(<ProposedActionCard action={action} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.queryByTitle('Proposed landing page preview')).toBeNull();
});
