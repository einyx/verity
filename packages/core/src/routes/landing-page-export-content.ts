import { type BriefInput } from './landing-page-brief.js';
import { budgetAssessmentGuard, type BudgetAssessment } from './landing-page-budget.js';

const available = (value: string | undefined, fallback = 'not available') =>
  value?.trim() ? value.trim() : fallback;

/** Only safe public links can be clickable in generated documents. Never fetches them. */
export const exportLink = (value: string | undefined): string | undefined => {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const isSynthetic = ({ lead, profile, exportContext }: BriefInput) => {
  const domains = [available(lead.email, '').split('@').at(-1), profile?.domain];
  return (
    profile?.syntheticContact === true ||
    ['synthetic', 'demo-data', 'fixture'].includes(profile?.researchStatus ?? '') ||
    ['synthetic', 'demo-data', 'demo data', 'test-data', 'fixture'].some((tag) =>
      exportContext?.tags?.some((value) => value.toLowerCase().trim() === tag)
    ) ||
    domains.some((value) => {
      const domain = value?.trim().toLowerCase();
      return domain === 'example.invalid' || domain?.endsWith('.example.invalid');
    })
  );
};

const userMessages = (transcript: unknown): string[] =>
  Array.isArray(transcript)
    ? transcript.flatMap((message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        message.role === 'user' &&
        'content' in message &&
        typeof message.content === 'string'
          ? [message.content]
          : []
      )
    : [];

/** Groups the thousands the same way in every document, without depending on a runtime locale. */
const usd = (amount: number) => `USD ${amount.toLocaleString('en-US')}`;

/** A list of notes, or a single line saying that none were stored. */
const optionalNotes = (
  values: readonly string[] | undefined,
  label: string,
  prefix: string
): string[] =>
  values && values.length > 0
    ? values.map((value) => `${prefix}: ${value}`)
    : [`${label}: not available`];

/** The public evidence behind the assessment, with the source it came from. */
const budgetEvidenceLines = (budget: BudgetAssessment | undefined): string[] =>
  budget && budget.evidence.length > 0
    ? budget.evidence.flatMap(({ sourceUrl, quote, signal }) => [
        `Public evidence context: ${signal}`,
        `Source: ${sourceUrl}; source publication date: not disclosed; assessment date: ${budget.assessedAt}`,
        `Source quote: ${quote}`,
      ])
    : ['Public evidence: not available'];

/** Stored advisory data is unknown at this boundary, including for non-route callers. */
const budgetLines = (value: unknown): string[] => {
  const parsed = budgetAssessmentGuard.safeParse(value);
  const budget = parsed.success ? parsed.data : undefined;
  const range = budget?.indicativeAnnualRange;
  return [
    `Assessment: ${budget ? 'available' : 'not available'}`,
    'Opportunity budget: not disclosed',
    'Internal vendor commercial scenario only; not known company funds or a binding quote.',
    'Demo reference: USD 150/month; not a customer budget.',
    'Bank planning anchor: USD 1,500,000/year - UNCONFIRMED annual period assumption; not observed company spend or available funds.',
    ...(budget ? [`Scenario label: ${budget.scenarioLabel}`] : []),
    range
      ? `Annual USD scenario range: low ${usd(range.low)}; base ${usd(range.base)}; high ${usd(range.high)}`
      : 'Annual USD scenario range: not available',
    `Confidence: ${budget?.confidence ?? 'not available'}`,
    `Assessment date: ${budget?.assessedAt ?? 'not available'}`,
    ...(budget?.businessType ? [`Business type hypothesis: ${budget.businessType}`] : []),
    ...(budget?.scaleHypothesis ? [`Scale hypothesis: ${budget.scaleHypothesis}`] : []),
    ...optionalNotes(budget?.assumptions, 'Assumptions', 'Assumption'),
    ...optionalNotes(budget?.rationale, 'Rationale', 'Rationale'),
    ...optionalNotes(budget?.discoveryQuestions, 'Discovery questions', 'Discovery question'),
    ...budgetEvidenceLines(budget),
  ];
};

/** Deterministic audience boundary. The prospect object is an explicit whitelist, never a spread. */
export const buildExportContent = (input: BriefInput) => {
  const { lead, profile, exportContext } = input;
  const synthetic = Boolean(isSynthetic(input));
  const company = available(lead.company, 'Company not available');
  const objective = available(
    lead.decision,
    'Stated objective not available; please confirm your goals.'
  );
  const sources = (profile?.sources ?? []).flatMap((source) => exportLink(source) ?? []);
  const researchDate =
    profile?.generatedAt && !Number.isNaN(Date.parse(profile.generatedAt))
      ? new Date(profile.generatedAt).toISOString().slice(0, 10)
      : 'not available';
  const summary = available(
    profile?.summary,
    'Company summary not available. No company profile yet.'
  );
  const questions = lead.decision?.trim()
    ? [
        'Which part of this stated objective should we explore first?',
        'How do you approach this decision today, and what would you like to change?',
        'What evidence would help you judge whether a different approach is useful?',
      ]
    : [
        'What goal would you like to explore?',
        'Which decision and team should we focus on?',
        'What would a useful next conversation cover?',
      ];

  const prospect = { company, objective, summary, sources, researchDate, synthetic, questions };
  const quotes = userMessages(exportContext?.transcript);
  const sections = [
    {
      title: 'Lead identity & stated needs',
      lines: [
        `Name: ${available([lead.firstName, lead.lastName].filter(Boolean).join(' '))}`,
        `Company: ${company}`,
        `Role: ${available(lead.role)}`,
        `Industry: ${available(lead.industry)}`,
        `Stated interests: ${available(lead.interests?.join(', '))}`,
        `Email: ${available(lead.email)}`,
        `Preferred contact: ${available(lead.contactMethod)}`,
        `Contact detail: ${available(lead.contactDetail)}`,
        `Stated objective: ${objective}`,
      ],
    },
    {
      title: 'Saved sales context - internal only',
      lines: [
        `Status: ${available(exportContext?.status)}`,
        `Tags: ${available(exportContext?.tags?.join(', '))}`,
        `Sales notes: ${available(exportContext?.notes)}`,
      ],
    },
    {
      title: 'AI-assisted public website research',
      lines: [
        summary,
        `Research date: ${researchDate}`,
        `Research status: ${available(profile?.researchStatus)}`,
        ...(sources.length > 0
          ? sources.map((source, index) => `Source ${index + 1}: ${source}`)
          : ['Source links: not available']),
      ],
    },
    {
      title: 'Budget advisory - internal only',
      lines: budgetLines(profile?.budgetAssessment),
    },
    {
      title: 'Stored visitor messages - evidence, not AI inference',
      lines: quotes.length > 0 ? quotes : ['Stored visitor messages: not available'],
    },
    {
      title: 'AI-inferred sales guidance - not visitor evidence',
      lines: [
        `Tone: ${available(profile?.conversation?.tone, 'not yet analysed')}`,
        ...(profile?.conversation?.outcomes?.length
          ? profile.conversation.outcomes.map((value) => `Predicted outcome: ${value}`)
          : ['Predicted outcomes: not available']),
        ...(profile?.conversation?.nextSteps?.length
          ? profile.conversation.nextSteps.map((value) => `Suggested next step: ${value}`)
          : ['Suggested next steps: not available']),
      ],
    },
  ];
  return { prospect, internal: { company, synthetic, sections } };
};

/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods -- Local wrapping accumulator; never mutates source data. */
/** Conservative line budget; splits oversized tokens without dropping characters or Unicode. */
export const wrapExportText = (text: string, limit: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const chunks: string[] = [];
    const chars = Array.from(word);
    for (let index = 0; index < chars.length; index += limit) {
      chunks.push(chars.slice(index, index + limit).join(''));
    }
    for (const chunk of chunks) {
      if (Array.from(line ? `${line} ${chunk}` : chunk).length > limit && line) {
        lines.push(line);
        line = '';
      }
      line = line ? `${line} ${chunk}` : chunk;
      if (Array.from(line).length === limit) {
        lines.push(line);
        line = '';
      }
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
};
/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods */
