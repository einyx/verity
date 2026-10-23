import { replyShapeProblems } from './landing-page-chat-shape.js';

// Stubbed first-pass replies for the proactive docs rule. They check the shape only: the model's live
// wording is not asserted here.
describe('proactive docs fixtures', () => {
  it.each([
    [
      'a plain question with no docs',
      'That sounds like a heavy monthly report. Who do I have the pleasure of chatting with?',
    ],
    [
      'a docs mention answered in one sentence',
      'Yes, the catalog covers that lineage. Which team owns the report?',
    ],
    [
      'a proactive pointer with no question inside it',
      'Roster planning is a scheduling problem, and the docs cover shift rules. What is your work email?',
    ],
    [
      'a URL that is not a sentence break',
      'See docs.meshx.io for the details. Which team owns the report?',
    ],
  ])('passes %s', (_name, reply) => {
    expect(replyShapeProblems(reply)).toEqual([]);
  });

  it('flags a proactive sentence that asks a second question', () => {
    expect(
      replyShapeProblems('Have you tried the shift rules? Which team owns the roster?')
    ).toEqual(['ask one question only']);
  });

  it('flags a reply that adds a proactive sentence on top of a long answer', () => {
    const reply =
      'Roster planning is a scheduling problem. The docs cover shift rules. Lineage is covered too. Which team owns the roster?';

    expect(replyShapeProblems(reply)).toEqual(['use at most 3 short sentences']);
  });

  it('flags a bulleted docs summary without an options line', () => {
    const reply = 'The docs cover:\n- shift rules\n- lineage\nWhich team owns the roster?';

    expect(replyShapeProblems(reply)).toEqual([
      'do not use a bulleted list unless you offer choices on the options line',
    ]);
  });
});
