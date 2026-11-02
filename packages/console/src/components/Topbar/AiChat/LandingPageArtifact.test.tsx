import { defaultLandingPageContent } from '@logto/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import ProposedActionCard, { type ProposedAction } from './ProposedActionCard';

jest.mock('@/consts/env', () => ({ isDevFeaturesEnabled: true }));

afterEach(() => {
  jest.restoreAllMocks();
});

const action: ProposedAction = {
  id: 'proposal',
  tool: 'save_landing_page_draft',
  body: defaultLandingPageContent,
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  status: 'pending',
};

it('keeps the same save and discard controls mounted and disabled while saving', () => {
  const confirm = jest.fn();
  const cancel = jest.fn();
  const { rerender } = render(
    <ProposedActionCard action={action} onConfirm={confirm} onCancel={cancel} />
  );
  const save = screen.getByRole('button', { name: 'Save draft' });
  const discard = screen.getByRole('button', { name: 'Discard' });
  rerender(
    <ProposedActionCard
      action={{ ...action, status: 'running' }}
      onConfirm={confirm}
      onCancel={cancel}
    />
  );
  expect(screen.getByRole('button', { name: 'Saving draft…' })).toBe(save);
  expect(save).toHaveProperty('disabled', true);
  expect(save.getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('button', { name: 'Discard' })).toBe(discard);
  expect(discard).toHaveProperty('disabled', true);
  fireEvent.click(save);
  fireEvent.click(discard);
  expect(confirm).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it.each(['done', 'failed', 'cancelled'] as const)(
  'does not offer another save after a %s result',
  (status) => {
    render(
      <ProposedActionCard
        action={{ ...action, status }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /Save draft|Saving draft/ })).toBeNull();
  }
);

it('keeps an expired draft visible and requires a refreshed review before explicit saving', async () => {
  const confirm = jest.fn();
  const refresh = jest.fn();
  function Review() {
    const [proposal, setProposal] = useState({
      ...action,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    return (
      <ProposedActionCard
        action={proposal}
        onConfirm={confirm}
        onCancel={jest.fn()}
        onRefresh={async () => {
          refresh();
          setProposal({
            ...action,
            id: 'renewed',
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          });
        }}
      />
    );
  }
  render(<Review />);
  const frame = screen.getByTitle('Proposed landing page preview');
  expect(screen.getByRole('button', { name: 'Save draft' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Save draft' })).toHaveProperty('disabled', false);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByTitle('Proposed landing page preview')).toBe(frame);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(confirm).toHaveBeenCalledTimes(1);
});

it('shows a rendered landing-page artifact instead of raw draft JSON', () => {
  render(<ProposedActionCard action={action} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  const frame = screen.getByTitle('Proposed landing page preview');
  const url = new URL(frame.getAttribute('src') ?? '');
  expect(url.origin + url.pathname).toBe(`${window.location.origin}/console/landing-preview`);
  expect(url.searchParams.get('cmsPreview')).toBe('1');
  expect(url.searchParams.get('cmsReadOnly')).toBe('1');
  expect(url.searchParams.get('cmsNonce')).toMatch(/^[\da-f]{32}$/);
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
    {
      type: 'meshx-cms-draft',
      doc: defaultLandingPageContent,
      nonce: new URL(frame.src).searchParams.get('cmsNonce'),
    },
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
  fireEvent(
    window,
    new MessageEvent('message', {
      origin: window.location.origin,
      source: frame.contentWindow,
      data: { type: 'meshx-cms-ready', nonce: 'wrong-preview' },
    })
  );
  expect(post).not.toHaveBeenCalled();
});

it('renders the same CMS artifact in production without enabling unrelated development features', () => {
  const flags = jest.requireMock<{ isDevFeaturesEnabled: boolean }>('@/consts/env');
  jest.replaceProperty(flags, 'isDevFeaturesEnabled', false);
  render(<ProposedActionCard action={action} onConfirm={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByTitle('Proposed landing page preview')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
});
