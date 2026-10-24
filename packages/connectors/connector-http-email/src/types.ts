import { z } from 'zod/v3';

export const httpMailConfigGuard = z.object({
  endpoint: z.string(),
  authorization: z.string().optional(),
});

export type HttpMailConfig = z.infer<typeof httpMailConfigGuard>;
