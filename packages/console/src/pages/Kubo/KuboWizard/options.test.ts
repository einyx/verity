import { stackOptions, templateHighlights } from './options';

describe('stackOptions', () => {
  it('offers the v1 template on the v1 choice', () => {
    const v1 = stackOptions.find(({ id }) => id === 'v1');

    expect(v1?.available).toBe(true);
    expect(v1?.template).toBe('v1');
    // The v1 template is standalone: nothing from the full template is excluded.
    expect(v1?.exclude).toEqual([]);
  });

  it('documents the secrets prerequisite on the v1 card', () => {
    const v1 = stackOptions.find(({ id }) => id === 'v1');

    expect(v1?.description).toContain('v1-demo-secrets');
  });

  it('labels the v1 card like the other templates', () => {
    expect(templateHighlights.v1.tags.length).toBeGreaterThan(0);
  });
});
