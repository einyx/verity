import { draftChanges } from './draft-changes';

it('summarizes changed copy and settings without returning the entire document', () => {
  expect(
    draftChanges(
      { hero: { title: 'Before', unchanged: 'Keep' }, demoChat: { enabled: true } },
      { hero: { title: 'After', unchanged: 'Keep' }, demoChat: { enabled: false } }
    )
  ).toEqual([
    { path: 'Demo chat › Enabled', before: 'On', after: 'Off' },
    { path: 'Hero › Title', before: 'Before', after: 'After' },
  ]);
});

it('includes added and removed copy while ignoring object key order', () => {
  expect(draftChanges({ title: 'Same', removed: 'Old' }, { added: 'New', title: 'Same' })).toEqual([
    { path: 'Added', before: 'Not set', after: 'New' },
    { path: 'Removed', before: 'Old', after: 'Not set' },
  ]);
  expect(draftChanges({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
});
