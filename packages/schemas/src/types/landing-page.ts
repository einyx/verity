import { z } from 'zod/v3';

// Structured content contract for the marketing page. Layout is selected by the section type;
// editors may order and repeat supported types, but cannot provide arbitrary markup.

const text = (max: number) => z.string().min(1).max(max);
const lines = (min: number, max: number, itemMax: number) =>
  z.array(text(itemMax)).min(min).max(max);
const safeLinkTarget = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) {
      return true;
    }

    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Link must be a same-site path, a section anchor, or an HTTPS URL');

const link = z.object({ label: text(120), href: safeLinkTarget });

const heroGuard = z.object({
  headline: lines(1, 4, 80),
  lede: text(500),
  primaryCta: link,
  secondaryCta: link,
  tertiaryCta: link,
  proofLabel: text(60),
  storyLinkLabel: text(60),
  storyLinkHref: safeLinkTarget,
});

const fomoGuard = z.object({
  heading: lines(1, 3, 120),
  pill: text(80),
  cells: z
    .array(z.object({ heading: text(60), body: text(200) }))
    .min(1)
    .max(12),
  foundationLabel: text(60),
  definition: text(400),
});

const howItWorksGuard = z.object({
  heading: lines(1, 3, 120),
  lede: text(400),
  cta: link,
});

const agentsGuard = z.object({
  heading: lines(1, 3, 120),
  lede: text(400),
  cards: z
    .array(z.object({ role: text(120), title: text(120), body: text(500), quote: text(300) }))
    .min(1)
    .max(12),
  cta: link.optional().default({ label: 'See the platform', href: '#platform' }),
});

const platformGuard = z.object({
  kicker: text(120),
  heading: lines(1, 3, 120),
  lede: text(500),
  rentedLabel: text(60),
  footnote: text(300),
});

const productsGuard = z.object({
  kicker: text(120),
  heading: lines(1, 3, 120),
  lede: text(500),
  products: z
    .array(
      z.object({
        name: text(80),
        badge: text(60),
        tagline: text(120),
        body: text(400),
        ctaLabel: text(80),
        ctaHref: safeLinkTarget,
      })
    )
    .min(1)
    .max(12),
});

const industriesGuard = z.object({
  kicker: text(120),
  heading: lines(1, 3, 120),
  lede: text(500),
  industries: z
    .array(
      z.object({
        name: text(80),
        badge: text(60),
        tag: text(60),
        body: text(400),
        bullets: lines(1, 5, 120),
        ctaLabel: text(80),
        ctaHref: safeLinkTarget,
      })
    )
    .min(1)
    .max(12),
});

const storiesGuard = z.object({
  kicker: text(120),
  heading: text(200),
  story: z.object({
    customer: text(60),
    sector: text(120),
    headline: text(200),
    body: text(600),
    ctaLabel: text(80),
    ctaHref: safeLinkTarget.optional().default('#demo-chat'),
  }),
  facts: z
    .array(z.object({ label: text(60), body: text(400) }))
    .min(1)
    .max(12),
});

const whyGuard = z.object({
  kicker: text(120),
  heading: lines(1, 3, 120),
  reasons: z
    .array(z.object({ label: text(60), heading: text(120), body: text(400) }))
    .min(1)
    .max(12),
  rows: z
    .array(z.object({ have: text(120), add: text(400) }))
    .min(1)
    .max(12),
});

const trustGuard = z.object({
  kicker: text(120),
  heading: text(200),
  commitments: z
    .array(z.object({ heading: text(120), body: text(400) }))
    .min(1)
    .max(12),
});

const closingCtaGuard = z.object({
  heading: text(200),
  body: text(300),
  primaryLabel: text(80),
  primaryHref: safeLinkTarget,
  secondaryLabel: text(80),
  secondaryHref: safeLinkTarget,
});

// Editor switch for the demo chat. Off keeps the static request form on the site. It lives in the
// document, not an environment variable, so editors can turn it off without a deploy.
const demoChatGuard = z.object({ enabled: z.boolean() });

const sectionBase = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[\w-]+$/),
});
export const landingPageSectionGuard = z.discriminatedUnion('type', [
  sectionBase.extend({ type: z.literal('hero'), ...heroGuard.shape }),
  sectionBase.extend({ type: z.literal('fomo'), ...fomoGuard.shape }),
  sectionBase.extend({ type: z.literal('howItWorks'), ...howItWorksGuard.shape }),
  sectionBase.extend({ type: z.literal('agents'), ...agentsGuard.shape }),
  sectionBase.extend({ type: z.literal('platform'), ...platformGuard.shape }),
  sectionBase.extend({ type: z.literal('products'), ...productsGuard.shape }),
  sectionBase.extend({ type: z.literal('industries'), ...industriesGuard.shape }),
  sectionBase.extend({ type: z.literal('stories'), ...storiesGuard.shape }),
  sectionBase.extend({ type: z.literal('why'), ...whyGuard.shape }),
  sectionBase.extend({ type: z.literal('trust'), ...trustGuard.shape }),
  sectionBase.extend({ type: z.literal('closingCta'), ...closingCtaGuard.shape }),
  sectionBase.extend({ type: z.literal('text'), heading: text(200), body: text(1200) }),
  sectionBase.extend({
    type: z.literal('image'),
    heading: text(200),
    src: z
      .string()
      .max(2048)
      .refine(
        (value) =>
          !value || (z.string().url().safeParse(value).success && value.startsWith('https://')),
        'Image URL must use HTTPS'
      ),
    alt: z.string().max(300),
    caption: z.string().max(500),
  }),
  sectionBase.extend({
    type: z.literal('cta'),
    heading: text(200),
    body: text(1200),
    buttonLabel: text(120),
    buttonHref: safeLinkTarget,
  }),
]);

export const landingPageDocumentGuard = z
  .object({
    // Live editor: stable authored element IDs keep header/media overrides independent of section order.
    elements: z
      .record(
        z
          .string()
          .regex(/^[\w-]{1,100}$/)
          .refine((key) => !['__proto__', 'constructor', 'prototype'].includes(key)),
        z
          .object({
            text: z.string().max(1000).optional(),
            href: safeLinkTarget.optional(),
            src: z
              .string()
              .url()
              .max(2048)
              .refine((value) => value.startsWith('https://'), 'Image URL must use HTTPS')
              .optional(),
            alt: z.string().max(300).optional(),
            fit: z.enum(['cover', 'contain']).optional(),
            x: z.number().int().min(-400).max(400).optional(),
            y: z.number().int().min(-400).max(400).optional(),
          })
          .strict()
      )
      .optional(),
    sections: z
      .array(landingPageSectionGuard)
      .min(2)
      .max(40)
      .superRefine((sections, context) => {
        for (const [index, section] of sections.entries()) {
          if (sections.slice(0, index).some((previous) => previous.id === section.id)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Section IDs must be unique',
              path: [index, 'id'],
            });
          }
        }
        const heroes = sections.filter(({ type }) => type === 'hero').length;
        const closingCtas = sections.filter(({ type }) => type === 'closingCta').length;
        if (heroes !== 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Exactly one Hero section is required',
            path: [],
          });
        }
        if (closingCtas !== 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Exactly one Closing CTA section is required',
            path: [],
          });
        }
      }),
    // Extra text that is editable in place, keyed by a `data-cms-copy` id on the page, then by language tag
    // (for example `it` or `pt-br`). A missing id or language keeps the page's own text. An empty value
    // is a text the editor cleared, so it is kept as it is.
    copy: z
      .record(z.string().max(80), z.record(z.string().max(10), z.string().max(1000)))
      .optional(),
    demoChat: demoChatGuard,
  })
  .strict();

export type LandingPageSection = z.infer<typeof landingPageSectionGuard>;
export type LandingPageDocument = z.infer<typeof landingPageDocumentGuard>;

export const landingPageResponseGuard = z.object({
  draft: landingPageDocumentGuard,
  published: landingPageDocumentGuard.nullable(),
  publishedVersion: z.number().int().positive().nullable(),
});

export type LandingPageResponse = z.infer<typeof landingPageResponseGuard>;
