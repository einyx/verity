/** Typed surface of the unmodified, MIT-licensed bidi-js 1.0.3 distribution beside this file. */
type EmbeddingLevels = {
  levels: Uint8Array;
  paragraphs: { start: number; end: number; level: number }[];
};

export default function bidiFactory(): {
  getEmbeddingLevels: (text: string, direction?: 'ltr' | 'rtl') => EmbeddingLevels;
  getReorderSegments: (text: string, levels: EmbeddingLevels) => [number, number][];
  getMirroredCharactersMap: (text: string, levels: EmbeddingLevels) => Map<number, string>;
};
