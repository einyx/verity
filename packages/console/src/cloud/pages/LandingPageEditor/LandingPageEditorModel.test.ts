import { defaultLandingPageContent } from '@logto/schemas';

import {
  addLandingPageSection,
  duplicateLandingPageSection,
  moveLandingPageSection,
  removeLandingPageSection,
} from './LandingPageEditorModel';
import type { LandingSectionType } from './LandingSectionBlocks';

const id = () => 'new-block';
const builtInType: LandingSectionType = 'hero';

it('adds supported blocks at a requested boundary with independent IDs', () => {
  expect(builtInType).toBe('hero');
  const result = addLandingPageSection(defaultLandingPageContent.sections, 'text', {
    targetId: 'platform',
    position: 'before',
    createId: id,
  });

  expect(result.map(({ type }) => type)).toContain('text');
  expect(result.findIndex(({ id: sectionId }) => sectionId === 'new-block')).toBe(4);
});

it('prevents adding or duplicating required singleton blocks', () => {
  expect(
    addLandingPageSection(defaultLandingPageContent.sections, 'hero', { createId: id })
  ).toEqual(defaultLandingPageContent.sections);
  expect(duplicateLandingPageSection(defaultLandingPageContent.sections, 'hero', id)).toEqual(
    defaultLandingPageContent.sections
  );
});

it('duplicates, moves, and removes optional blocks while keeping required blocks', () => {
  const duplicated = duplicateLandingPageSection(
    defaultLandingPageContent.sections,
    'platform',
    id
  );
  expect(duplicated).toHaveLength(defaultLandingPageContent.sections.length + 1);
  expect(duplicated.find(({ id: sectionId }) => sectionId === 'new-block')).toMatchObject({
    type: 'platform',
  });

  const moved = moveLandingPageSection(duplicated, 'new-block', 0);
  expect(moved[0]?.id).toBe('new-block');
  const removed = removeLandingPageSection(moved, 'hero');
  expect(removed).toEqual(moved);
  expect(removeLandingPageSection(moved, 'platform')).toHaveLength(moved.length - 1);
});

it('retries colliding IDs and creates independent copies of nested section data', () => {
  const createId = jest.fn().mockReturnValueOnce('platform').mockReturnValue('independent');
  const result = duplicateLandingPageSection(
    defaultLandingPageContent.sections,
    'platform',
    createId
  );
  const source = defaultLandingPageContent.sections.find(({ id }) => id === 'platform');
  const duplicate = result.find(({ id }) => id === 'independent');

  expect(createId).toHaveBeenCalledTimes(2);
  expect(duplicate).toEqual({ ...source, id: 'independent' });
  expect(duplicate).not.toBe(source);
  if (source?.type === 'platform' && duplicate?.type === 'platform') {
    expect(duplicate.heading).not.toBe(source.heading);
  }
});
