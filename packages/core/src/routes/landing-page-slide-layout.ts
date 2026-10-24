// Conservative Arial advance widths in ems, with extra allowance for unmeasured scripts.
// This is a layout budget, not a font dependency: Office keeps the resulting text editable.
const advance = (character: string): number => {
  if (/\p{Mark}/u.test(character)) {
    return 0;
  }
  if (/\s/u.test(character)) {
    return 0.35;
  }
  if (/[ilI.,:;'!|]/u.test(character)) {
    return 0.34;
  }
  if (/[MW@%&#]/u.test(character)) {
    return 1.05;
  }
  if (/[A-Z]/u.test(character)) {
    return 0.82;
  }
  if (/[mw]/u.test(character)) {
    return 0.95;
  }
  if (/[a-z0-9/()_?=+-]/u.test(character)) {
    return 0.66;
  }
  return (character.codePointAt(0) ?? 0) > 0x2_ff ? 1.25 : 0.9;
};

const balanceEnding = (lines: string[], budget: number, original: string): string[] => {
  const last = lines.at(-1);
  const previous = lines.at(-2);
  if (!last || !previous || last.includes(' ') || !original.trim().endsWith(` ${last}`)) {
    return lines;
  }
  const words = previous.split(' ');
  if (words.length < 4) {
    return lines;
  }
  const ending = [...words.slice(-2), last].join(' ');
  const width = Array.from(ending).reduce((sum, character) => sum + advance(character), 0);
  return width <= budget ? [...lines.slice(0, -2), words.slice(0, -2).join(' '), ending] : lines;
};

/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods -- Local line accumulator only; source strings are immutable. */
/** Width-aware wrapping with 12% metric slack. Oversized tokens continue without dropping glyphs. */
export const wrapSlideText = (text: string, widthInches: number, fontSize: number): string[] => {
  const budget = ((widthInches * 72) / fontSize) * 0.88;
  const lines: string[] = [];
  let line = '';
  let used = 0;
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const width = Array.from(word).reduce((sum, character) => sum + advance(character), 0);
    if (line && used + 0.35 + width > budget) {
      lines.push(line);
      line = '';
      used = 0;
    }
    if (line) {
      line += ' ';
      used += 0.35;
    }
    for (const character of word) {
      const width = advance(character);
      if (line && used + width > budget) {
        lines.push(line);
        line = '';
        used = 0;
      }
      line += character;
      used += width;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? balanceEnding(lines, budget, text) : [''];
};
/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods */
