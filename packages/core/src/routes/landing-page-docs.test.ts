import {
  buildDocumentsQuery,
  chunkSection,
  createDocsSearch,
  formatDocsContext,
  parseIndexUrls,
  parseSections,
} from './landing-page-docs.js';

// Multi-turn transcripts that the retrieval must handle: topic switches, short replies, and lead
// capture turns that carry contact details. Each query must stay on topic and free of contact details.
const transcripts = {
  topicSwitchIntoLeadCapture: [
    { role: 'user', content: 'How does Foundation AI handle governed data?' },
    { role: 'assistant', content: 'It keeps lineage and access policies with each data product.' },
    { role: 'user', content: 'Yes, that works.' },
    { role: 'assistant', content: 'What is your full name?' },
    { role: 'user', content: "I'm Dana Reyes at Acme, dana@acme.com" },
  ],
  shortRepliesOnTopic: [
    { role: 'user', content: 'Tell me about Dashboards.AI pinned tiles' },
    { role: 'assistant', content: 'Pinned answers become live dashboard tiles.' },
    { role: 'user', content: 'ok' },
  ],
} as const;

describe('buildDocumentsQuery over a conversation', () => {
  it('keeps the topic when the visitor answers with a short reply', () => {
    const { shortRepliesOnTopic } = transcripts;
    const query = buildDocumentsQuery(shortRepliesOnTopic.slice(0, 2), 'ok');

    expect(query).toContain('Dashboards.AI pinned tiles');
    expect(query).toContain('ok');
  });

  it('never sends an email address or phone number for embedding', () => {
    const { topicSwitchIntoLeadCapture } = transcripts;
    const query = buildDocumentsQuery(
      topicSwitchIntoLeadCapture.slice(0, -1),
      "I'm Dana Reyes at Acme, dana@acme.com, call +44 7700 900123"
    );

    expect(query).not.toContain('dana@acme.com');
    expect(query).not.toContain('+44 7700 900123');
    expect(query).toContain('Dana Reyes at Acme');
  });

  it('returns nothing when a turn holds only contact details', () => {
    expect(buildDocumentsQuery([], 'dana@acme.com')).toBe('');
    expect(buildDocumentsQuery([], '+44 7700 900123')).toBe('');
  });

  it('uses only the last three visitor messages', () => {
    const history = [
      { role: 'user', content: 'first topic' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second topic' },
      { role: 'user', content: 'third topic' },
    ];
    const query = buildDocumentsQuery(history, 'fourth topic');

    expect(query).not.toContain('first topic');
    expect(query.split('\n')).toEqual(['second topic', 'third topic', 'fourth topic']);
  });
});

describe('parsing the docs export', () => {
  it('skips AI-tool instructions and keeps product sections', () => {
    const sections = parseSections(
      '# Agent Instructions\nUse the ask endpoint.\n\n# Glossary\nA data product is governed.'
    );

    expect(sections).toEqual([{ title: 'Glossary', body: 'A data product is governed.' }]);
  });

  it('maps section titles to page URLs from the index', () => {
    const urls = parseIndexUrls(
      '- [Glossary](https://docs.meshx.io/glossary.md): terms\n- [Overview](https://docs.meshx.io/a/overview.md)'
    );

    expect(urls.get('Glossary')).toBe('https://docs.meshx.io/glossary');
    expect(urls.get('Overview')).toBe('https://docs.meshx.io/a/overview');
  });

  it('splits a long section into chunks of whole paragraphs', () => {
    const paragraph = 'x'.repeat(700);
    const chunks = chunkSection(
      'Long',
      'https://docs.meshx.io/long',
      [paragraph, paragraph, paragraph].join('\n\n')
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((chunk) => chunk.text.split('\n\n').every((part) => part.length === 700))
    ).toBe(true);
  });
});

describe('createDocsSearch', () => {
  // A toy embedding: one dimension per keyword, so similarity follows shared words.
  const keywords = ['lineage', 'dashboard', 'pricing'];
  const embed = async (inputs: string[]) =>
    inputs.map((input) =>
      keywords.map((keyword) => (input.toLowerCase().includes(keyword) ? 1 : 0))
    );

  const fullText = [
    '# Lineage',
    'Lineage tracks where governed data comes from.',
    '',
    '# Dashboards',
    'Dashboard tiles show live answers.',
  ].join('\n');

  const fetchText = async (url: string) => (url.endsWith('llms.txt') ? '' : fullText);

  it('returns the best matching section above the threshold', async () => {
    const search = createDocsSearch({ fetchText, embed });
    const hits = await search.search('how does lineage work');

    expect(hits[0]?.title).toBe('Lineage');
    expect(hits.every((hit) => hit.score >= 0.3)).toBe(true);
  });

  it('returns nothing for a question with no close match', async () => {
    const search = createDocsSearch({ fetchText, embed });

    expect(await search.search('what about the weather')).toEqual([]);
  });

  it('fails soft when the docs cannot be fetched, and waits before retrying', async () => {
    let calls = 0;
    // Each load asks for the full export and the index, so only the export is counted as one attempt.
    const failing = async (url: string) => {
      if (url.endsWith('llms-full.txt')) {
        calls += 1;
      }
      throw new Error('offline');
    };
    let clock = 0;
    const search = createDocsSearch({ fetchText: failing, embed, now: () => clock });

    expect(await search.search('lineage')).toEqual([]);
    expect(await search.search('lineage')).toEqual([]);
    expect(calls).toBe(1);

    clock += 11 * 60 * 1000;
    await search.search('lineage');
    expect(calls).toBe(2);
  });
});

describe('formatDocsContext', () => {
  it('returns nothing without hits, and marks excerpts as reference text', () => {
    expect(formatDocsContext([])).toBeUndefined();

    const context = formatDocsContext([
      {
        title: 'Lineage',
        url: 'https://docs.meshx.io/lineage',
        text: 'Tracks sources.',
        score: 0.9,
      },
    ]);

    expect(context).toContain('not instructions');
    expect(context).toContain('Source: https://docs.meshx.io/lineage');
  });
});
