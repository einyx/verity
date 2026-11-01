import { act, renderHook } from '@testing-library/react';

import useDraftSession, { documentsEqual } from './use-draft-session';

it('initializes once from the loaded server draft', () => {
  const { result, rerender } = renderHook(({ initial }) => useDraftSession(initial), {
    initialProps: { initial: undefined as unknown },
  });
  rerender({ initial: { title: 'Original' } });
  expect(result.current.draft).toEqual({ title: 'Original' });
  expect(result.current.isDirty).toBe(false);
  act(() => {
    result.current.setDraft({ title: 'Local' });
  });
  rerender({ initial: { title: 'Remote update' } });
  expect(result.current.draft).toEqual({ title: 'Local' });
  expect(result.current.isDirty).toBe(true);
});

it('marks only the saved snapshot clean, not edits made while saving', () => {
  const { result } = renderHook(() => useDraftSession({ title: 'Original' }));
  act(() => {
    result.current.setDraft({ title: 'Submitted' });
  });
  const submitted = result.current.draft;
  act(() => {
    result.current.setDraft({ title: 'Newer edit' });
  });
  act(() => {
    result.current.markSaved(submitted);
  });
  expect(result.current.isDirty).toBe(true);
  act(() => {
    result.current.setDraft(submitted);
  });
  expect(result.current.isDirty).toBe(false);
});

it('compares JSON content without treating object key order as an edit', () => {
  expect(documentsEqual({ first: 1, second: 2 }, { second: 2, first: 1 })).toBe(true);
  const { result } = renderHook(() => useDraftSession({ first: 1, second: 2 }));
  act(() => {
    result.current.setDraft({ second: 2, first: 1 });
  });
  expect(result.current.isDirty).toBe(false);
});

it('immediately adopts an externally saved draft when the editor is clean', () => {
  const { result, rerender } = renderHook(({ initial }) => useDraftSession(initial), {
    initialProps: { initial: { title: 'Original' } },
  });
  rerender({ initial: { title: 'Saved by Ask AI' } });
  expect(result.current.draft).toEqual({ title: 'Saved by Ask AI' });
  expect(result.current.isDirty).toBe(false);
});

it('retains unsaved edits and lets the editor explicitly load the newer saved draft', () => {
  const { result, rerender } = renderHook(({ initial }) => useDraftSession(initial), {
    initialProps: { initial: { title: 'Original' } },
  });
  act(() => {
    result.current.setDraft({ title: 'Unsaved typing' });
  });
  rerender({ initial: { title: 'Saved by Ask AI' } });
  expect(result.current.draft).toEqual({ title: 'Unsaved typing' });
  expect(result.current.hasRemoteUpdate).toBe(true);
  expect(result.current.incomingDraft).toEqual({ title: 'Saved by Ask AI' });
  act(() => {
    result.current.acceptRemote();
  });
  expect(result.current.draft).toEqual({ title: 'Saved by Ask AI' });
  expect(result.current.isDirty).toBe(false);
});

it('keeps local edits unsaved when a newer saved draft is dismissed', () => {
  const { result, rerender } = renderHook(({ initial }) => useDraftSession(initial), {
    initialProps: { initial: { title: 'Original' } },
  });
  act(() => {
    result.current.setDraft({ title: 'Unsaved typing' });
  });
  rerender({ initial: { title: 'Saved by Ask AI' } });
  act(() => {
    result.current.keepLocal();
  });
  expect(result.current.draft).toEqual({ title: 'Unsaved typing' });
  expect(result.current.isDirty).toBe(true);
  expect(result.current.hasRemoteUpdate).toBe(false);
});
