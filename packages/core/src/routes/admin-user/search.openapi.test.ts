import { removeDevFeatureParameters } from '../swagger/utils/general.js';

import document from './search.openapi.json' with { type: 'json' };

it('documents the suspension filter as a released parameter', () => {
  const copy = structuredClone(document);
  removeDevFeatureParameters(copy);

  expect(copy.paths['/api/users'].get.parameters.some(({ name }) => name === 'isSuspended')).toBe(
    true
  );
  expect(JSON.stringify(copy)).not.toContain('x-logto-dev-feature');
});
