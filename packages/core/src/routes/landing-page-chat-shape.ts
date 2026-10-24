// Checks a visitor-facing reply against the chat's shape rules: one question, at most three sentences, and
// no bullet list unless the reply offers choices as buttons. The model follows these only most of the time,
// so the route asks once more when a reply breaks one, with the broken rule named in the correction.

const maxSentences = 3;
const optionsLine = /\[\[options:[^\]]*]]/;
const bulletLine = /^\s*[*-]\s+\S/m;

/** Rules a reply breaks, in plain words for the model. Empty when the reply is within the shape. */
export const replyShapeProblems = (content: string): string[] => {
  const questions = (content.match(/\?/g) ?? []).length;
  const sentences = content.split(/[!.?]+(\s|$)/).filter((part) => part.trim().length > 0).length;

  return [
    questions > 1 ? 'ask one question only' : undefined,
    sentences > maxSentences ? `use at most ${maxSentences} short sentences` : undefined,
    bulletLine.test(content) && !optionsLine.test(content)
      ? 'do not use a bulleted list unless you offer choices on the options line'
      : undefined,
  ].filter((problem): problem is string => problem !== undefined);
};

/** The note the model gets with the retry, so it fixes exactly what was wrong. */
export const shapeCorrection = (problems: string[]): string =>
  `Your last reply broke the chat's shape rules. Rewrite it, keeping the same meaning: ${problems.join('; ')}. Reply with the rewritten text only.`;
