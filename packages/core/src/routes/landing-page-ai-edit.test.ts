import { defaultLandingPageContent, landingPageDocumentGuard } from '@logto/schemas';

import {
  landingPageAiEditSystemPrompt,
  parseLandingPageAiEdit,
  parseLandingPageAiEditResponse,
} from './landing-page-ai-edit.js';

it('directs AI to duplicate an existing section structure when adding one', () => {
  expect(landingPageAiEditSystemPrompt).toContain('duplicate the closest existing section');
  expect(landingPageAiEditSystemPrompt).toContain('Security & Governance section');
});

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
