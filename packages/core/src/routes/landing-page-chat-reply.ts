import { z } from 'zod/v3';

// Reads the model's response for the landing page chat. Anything unexpected becomes "no reply", so
// the visitor gets a clean message rather than a parsing error.

export type ModelReply = { content?: string; lead?: unknown };

/** The shape of the model response this route reads. Anything else is treated as no reply. */
const modelResponseGuard = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                function: z.object({ name: z.string(), arguments: z.string() }),
              })
            )
            .optional(),
        }),
      })
    )
    .min(1),
});

const parseArguments = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const readModelReply = (data: unknown): ModelReply => {
  const parsed = modelResponseGuard.safeParse(data);

  if (!parsed.success) {
    return {};
  }

  const message = parsed.data.choices[0]?.message;
  const call = message?.tool_calls?.find((item) => item.function.name === 'submit_lead');

  return {
    content: message?.content ?? undefined,
    lead: call ? parseArguments(call.function.arguments) : undefined,
  };
};
