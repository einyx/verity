import { replyShapeProblems } from './landing-page-chat-shape.js';

describe('replyShapeProblems', () => {
  it('passes a short reply with one question', () => {
    expect(
      replyShapeProblems('Great to meet you! What is the decision you want to see answered live?')
    ).toEqual([]);
  });

  it('flags a reply with two questions', () => {
    expect(replyShapeProblems('What is your role? And which team do you run?')).toEqual([
      'ask one question only',
    ]);
  });

  it('flags a reply with more than three sentences', () => {
    const content = 'One. Two. Three. Four. What is your name?';

    expect(replyShapeProblems(content)).toContain('use at most 3 short sentences');
  });

  it('does not count a dot inside a product name as a sentence break', () => {
    expect(replyShapeProblems('Dashboards.AI turns questions into live dashboards.')).toEqual([]);
  });

  it('flags a bulleted list when there is no options line', () => {
    expect(replyShapeProblems('Pick one:\n- Rosters\n- Reports')).toEqual([
      'do not use a bulleted list unless you offer choices on the options line',
    ]);
  });

  it('allows a bulleted list when the reply carries an options line', () => {
    expect(
      replyShapeProblems('How would you like to be contacted?\n[[options: Email | WhatsApp]]')
    ).toEqual([]);
  });
});
