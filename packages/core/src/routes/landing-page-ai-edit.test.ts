import { defaultLandingPageContent, landingPageDocumentGuard } from '@logto/schemas';

import { parseLandingPageAiEdit, parseLandingPageAiEditResponse } from './landing-page-ai-edit.js';

describe('parseLandingPageAiEdit', () => {
  it('accepts only a valid landing page document from the model', () => {
    const result = parseLandingPageAiEdit(JSON.stringify(defaultLandingPageContent));

    expect(result).toEqual(landingPageDocumentGuard.parse(defaultLandingPageContent));
  });

  it('rejects invalid model output instead of passing it to the editor', () => {
    expect(() => parseLandingPageAiEdit('{"sections":[{"type":"unknown"}]}')).toThrow();
    expect(() => parseLandingPageAiEdit('not json')).toThrow();
  });

  it('returns no suggestion when the model response has no content', () => {
    expect(
      parseLandingPageAiEditResponse({ choices: [{ message: { content: null } }] })
    ).toBeUndefined();
  });
});
