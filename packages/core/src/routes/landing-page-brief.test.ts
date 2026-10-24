import { type BriefInput, buildBriefHtml, renderBriefPdf } from './landing-page-brief.js';

const input: BriefInput = {
  lead: {
    firstName: 'Sam',
    lastName: 'Lee',
    email: 'sam@acme-logistics.com',
    company: 'Acme <Logistics>',
    role: 'COO',
    decision: 'Reduce late deliveries',
  },
  profile: {
    summary: 'Acme moves cold-chain freight across Europe.',
    domain: 'acme-logistics.com',
    sources: ['https://acme-logistics.com/'],
    generatedAt: '2026-10-21T10:00:00.000Z',
    conversation: {
      tone: 'curious and direct',
      outcomes: ['Books a discovery call'],
      nextSteps: ['Show late-delivery root causes'],
    },
  },
  bookingUrl: 'https://book.example.com/meshx',
};

describe('buildBriefHtml', () => {
  it('escapes lead and company values so they cannot inject markup', () => {
    const html = buildBriefHtml(input);
    expect(html).toContain('Acme &lt;Logistics&gt;');
    expect(html).not.toContain('Acme <Logistics>');
  });

  it('includes the tone, outcomes, next steps and the booking link', () => {
    const html = buildBriefHtml(input);
    expect(html).toContain('curious and direct');
    expect(html).toContain('Books a discovery call');
    expect(html).toContain('Show late-delivery root causes');
    expect(html).toContain('https://book.example.com/meshx');
  });

  it('leaves out the booking link when no scheduling URL is configured', () => {
    expect(buildBriefHtml({ ...input, bookingUrl: undefined })).not.toContain(
      'Book the next meeting'
    );
  });

  it('says so when no company profile exists yet', () => {
    const html = buildBriefHtml({ lead: input.lead });
    expect(html).toContain('No company profile yet');
  });
});

describe('renderBriefPdf', () => {
  it('renders a PDF with the local Chrome', async () => {
    const pdf = await renderBriefPdf(input);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
  }, 60_000);
});
