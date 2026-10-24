import { type z } from 'zod/v3';

export type ToZodObject<T> = z.ZodObject<{
  [K in keyof T]-?: z.ZodType<T[K]>;
}>;
