import { type LandingPageDocument, landingPageDocumentGuard } from '@logto/schemas';
import { z } from 'zod/v3';

const responseGuard = z.object({
  choices: z
    .array(
      z.object({ message: z.object({ content: z.string().nullable().optional() }).optional() })
    )
    .optional(),
});

/** Model output is untrusted; only a complete CMS-valid document can enter the editor. */
export const parseLandingPageAiEdit = (content: string): LandingPageDocument =>
  landingPageDocumentGuard.parse(JSON.parse(content));

export const parseLandingPageAiEditResponse = (response: unknown) => {
  const parsed = responseGuard.safeParse(response);
  const content = parsed.success ? parsed.data.choices?.[0]?.message?.content : undefined;

  if (!content) {
    return;
  }

  try {
    return parseLandingPageAiEdit(content);
  } catch {}
};
