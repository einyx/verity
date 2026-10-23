import pptxgenModule from 'pptxgenjs';

import { type BriefInput } from './landing-page-brief.js';
import { brand, wordmarkPngBase64 } from './landing-page-brand.js';

// The package is CommonJS at runtime, where its default import is the class itself. Its typings describe an
// ES default export that TypeScript resolves differently, so the class is read through this cast. The
// interfaces list only what this file uses.
type Text = { text: string; options: Record<string, unknown> };
type Slide = {
  background: { color: string };
  addText: (text: string | Text[], options: Record<string, unknown>) => void;
  addImage: (options: Record<string, unknown>) => void;
};
type Deck = {
  layout: string;
  title: string;
  company: string;
  addSlide: () => Slide;
  write: (options: { outputType: 'nodebuffer' }) => Promise<unknown>;
};
const PptxGenJS = pptxgenModule as unknown as new () => Deck;

// A short deck for a sales lead, built from what the landing chat collected: who they are, their company
// profile, and the outcomes and next steps from the conversation. It follows the meshX sales deck: a
// situation, what meshX offers, the value for their team, and the next step. Colours and type match the
// brief and the deck (warm off-white, red accent, serif headings).

const colours = {
  background: brand.background,
  ink: brand.ink,
  muted: brand.muted,
  accent: brand.accent,
};

const fonts = { heading: brand.headingFont, body: brand.bodyFont };

const productLines = [
  'Foundation AI: the intelligence layer that routes every question to a sourced, governed answer.',
  'Foundation Data: governed data exchange across systems, with lineage and access control.',
  'Dashboards.AI: ask in plain language, then pin the answer as a live tile.',
  'V1.AI: build focused apps and agents on your enterprise intelligence.',
];

const valueLines = [
  'Decisions in minutes, not days, from data your teams already trust.',
  'Governance that says yes to the business, with permissions that follow the data.',
  'A business case you can see before you commit, and one that builds as the model matures.',
  'Zero to value in about 30 days, starting with one operational decision.',
];

type Lead = BriefInput['lead'];

const fullName = (lead: Lead) => `${lead.firstName} ${lead.lastName}`.trim();

const addTitleSlide = (deck: Deck, lead: Lead, date: string) => {
  const slide = deck.addSlide();
  slide.background = { color: colours.background };
  slide.addImage({
    data: `image/png;base64,${wordmarkPngBase64}`,
    x: 0.7,
    y: 0.6,
    w: 2.4,
    h: 0.44,
  });
  slide.addText(`Enterprise intelligence for ${lead.company}`, {
    x: 0.7,
    y: 2.2,
    w: 11.9,
    h: 1.6,
    fontFace: fonts.heading,
    fontSize: 40,
    color: colours.ink,
  });
  slide.addText(`Prepared for ${fullName(lead)}${lead.role ? `, ${lead.role}` : ''} · ${date}`, {
    x: 0.7,
    y: 4.1,
    w: 11.9,
    h: 0.5,
    fontFace: fonts.body,
    fontSize: 16,
    color: colours.muted,
  });
};

const addBulletSlide = (deck: Deck, title: string, body: string | undefined, bullets: string[]) => {
  const slide = deck.addSlide();
  slide.background = { color: colours.background };
  slide.addText(title, {
    x: 0.7,
    y: 0.5,
    w: 11.9,
    h: 0.9,
    fontFace: fonts.heading,
    fontSize: 30,
    color: colours.ink,
  });

  if (body) {
    slide.addText(body, {
      x: 0.7,
      y: 1.5,
      w: 11.9,
      h: 1.6,
      fontFace: fonts.body,
      fontSize: 18,
      color: colours.ink,
      valign: 'top',
    });
  }

  slide.addText(
    bullets.map((text) => ({ text, options: { bullet: { code: '25A0' }, breakLine: true } })),
    {
      x: 0.7,
      y: body ? 3.2 : 1.6,
      w: 11.9,
      h: 3.6,
      fontFace: fonts.body,
      fontSize: 18,
      color: colours.ink,
      valign: 'top',
      paraSpaceAfter: 10,
    }
  );
};

/**
 * Builds the slide deck for a lead. Every value is written as plain text, so nothing is interpreted as
 * markup. Returns the file as a buffer.
 */
export const buildSlidesDeck = async (input: BriefInput, date: string): Promise<Buffer> => {
  const { lead, profile, bookingUrl } = input;
  const conversation = profile?.conversation;
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.title = `meshX for ${lead.company}`;
  deck.company = 'meshX';

  addTitleSlide(deck, lead, date);

  addBulletSlide(
    deck,
    `Where ${lead.company} is today`,
    profile?.summary,
    profile?.sources?.length
      ? profile.sources
      : ['Context from the conversation is still being gathered.']
  );

  addBulletSlide(
    deck,
    'What we heard',
    undefined,
    conversation?.outcomes?.length
      ? conversation.outcomes
      : ['Priorities and open questions to confirm in the first meeting.']
  );

  addBulletSlide(deck, 'Where meshX fits', undefined, productLines);

  addBulletSlide(deck, 'What it means for your team', undefined, valueLines);

  addBulletSlide(
    deck,
    'Proposed next steps',
    undefined,
    conversation?.nextSteps?.length
      ? conversation.nextSteps
      : [
          'Pick one operational decision to walk through together.',
          'Agree who joins the next meeting.',
        ]
  );

  const closing = deck.addSlide();
  closing.background = { color: colours.background };
  closing.addText('Start building intelligence your business owns.', {
    x: 0.7,
    y: 2.4,
    w: 11.9,
    h: 1.2,
    fontFace: fonts.heading,
    fontSize: 34,
    color: colours.ink,
  });
  if (bookingUrl) {
    closing.addText(`Book the next meeting: ${bookingUrl}`, {
      x: 0.7,
      y: 3.9,
      w: 11.9,
      h: 0.5,
      fontFace: fonts.body,
      fontSize: 16,
      color: colours.muted,
    });
  }

  const output = await deck.write({ outputType: 'nodebuffer' });

  return output as Buffer;
};
