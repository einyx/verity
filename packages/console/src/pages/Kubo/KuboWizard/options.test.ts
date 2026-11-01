import { stackOptions, templateHighlights } from './options';

describe('stackOptions', () => {
  it('offers the v1 template on the v1 choice', () => {
    const v1 = stackOptions.find(({ id }) => id === 'v1');

    expect(v1?.available).toBe(true);
    expect(v1?.template).toBe('v1');
    // The v1 template is standalone: nothing from the full template is excluded.
    expect(v1?.exclude).toEqual([]);
  });

  it('keeps administrator prerequisites separate from the business description', () => {
    const v1 = stackOptions.find(({ id }) => id === 'v1');

    expect(v1?.description).toBe(
      'Evaluate the V1 app-building experience in a standalone demo workspace.'
    );
    expect(v1?.setupRequirement).toContain('v1-demo-secrets');
    expect(v1?.description).not.toMatch(/Vite|Postgres|namespace|Secret/);
  });

  it('explains workspace choices in terms of business use', () => {
    expect(stackOptions.map(({ id, title, description }) => ({ id, title, description }))).toEqual([
      {
        id: 'foundation',
        title: 'Foundation',
        description: 'Manage business data, analytics, and AI in one complete workspace.',
      },
      {
        id: 'dai',
        title: 'Dashboards AI',
        description: 'Explore business data and turn questions into insights and dashboards.',
      },
      {
        id: 'fai',
        title: 'Foundation AI',
        description: 'Add AI capabilities to your existing data and applications.',
      },
      {
        id: 'v1',
        title: 'V1 demo',
        description: 'Evaluate the V1 app-building experience in a standalone demo workspace.',
      },
    ]);
    expect(templateHighlights).toEqual({
      foundation: { tags: ['Data platform', 'Analytics', 'AI ready'], recommended: true },
      dai: { tags: ['Business insights', 'AI dashboards'] },
      fai: { tags: ['AI integration', 'Existing platforms'] },
      v1: { tags: ['App creation', 'Product demo'] },
    });
  });

  it('labels the v1 card like the other templates', () => {
    expect(templateHighlights.v1.tags.length).toBeGreaterThan(0);
  });
});
