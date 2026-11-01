export const followUpParagraphs = (value: string): string[] =>
  value
    .replaceAll(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

export const hasUnfinishedSignature = (value: string) =>
  /\[(?:your\s+(?:name|company)|sender\s+name|company\s+name)]/i.test(value);

/** Only whitespace changes: keep the author's words while separating flat AI-generated drafts. */
export const formatFollowUpDraft = (value: string): string => {
  const text = value.replaceAll(/\r\n?/g, '\n').trim();
  if (/\n\s*\n/.test(text)) {
    return text;
  }
  const greeting = /^(?:hi|hello|dear)\s+[^\n,]{1,100},\s*/i.exec(text);
  const remainder = greeting ? text.slice(greeting[0].length) : text;
  const closing =
    /(?:^|\s)((?:best regards|kind regards|sincerely|regards)[,.]?\s*[\S\s]{0,200})$/i.exec(
      remainder
    );
  const body = closing ? remainder.slice(0, closing.index).trim() : remainder;
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/u).filter(Boolean);
  const paragraphs = Array.from({ length: Math.ceil(sentences.length / 2) }, (_, index) =>
    sentences.slice(index * 2, index * 2 + 2).join(' ')
  );
  return [greeting?.[0].trim(), ...paragraphs, closing?.[1].trim()].filter(Boolean).join('\n\n');
};
