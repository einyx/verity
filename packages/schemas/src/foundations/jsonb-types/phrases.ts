import { z } from 'zod/v3';

export type Translation = {
  [key: string]: string | Translation;
};

export const translationGuard: z.ZodType<Translation> = z.lazy(() =>
  z.record(z.string().or(translationGuard))
);
