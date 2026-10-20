import { z } from 'zod';

// Landing page CMS content. The marketing site keeps its section order and layout in code; this
// document holds the copy for each section, so editors change words without touching structure.
// Lists have fixed lengths because each section's layout is built for that many items. Keep the
// shapes in step with the site's section components.

const text = (max: number) => z.string().min(1).max(max);
const lines = (min: number, max: number, itemMax: number) =>
  z.array(text(itemMax)).min(min).max(max);
const link = z.object({ label: text(120), href: text(2048) });

const heroGuard = z.object({
  headline: lines(1, 4, 80),
  lede: text(500),
  primaryCta: link,
  secondaryCta: link,
  proofLabel: text(60),
  storyLinkLabel: text(60),
});

const fomoGuard = z.object({
  heading: lines(1, 3, 120),
  pill: text(80),
  cells: z.array(z.object({ heading: text(60), body: text(200) })).length(4),
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
    .length(6),
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
        ctaHref: text(2048),
      })
    )
    .length(4),
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
        ctaHref: text(2048),
      })
    )
    .length(2),
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
  }),
  facts: z.array(z.object({ label: text(60), body: text(400) })).length(4),
});

const whyGuard = z.object({
  kicker: text(120),
  heading: lines(1, 3, 120),
  reasons: z.array(z.object({ label: text(60), heading: text(120), body: text(400) })).length(3),
  rows: z.array(z.object({ have: text(120), add: text(400) })).length(4),
});

const trustGuard = z.object({
  kicker: text(120),
  heading: text(200),
  commitments: z.array(z.object({ heading: text(120), body: text(400) })).length(4),
});

const closingCtaGuard = z.object({
  heading: text(200),
  body: text(300),
  primaryLabel: text(80),
  secondaryLabel: text(80),
});

// Editor switch for the demo chat. Off keeps the static request form on the site. It lives in the
// document, not an environment variable, so editors can turn it off without a deploy.
const demoChatGuard = z.object({ enabled: z.boolean() });

export const landingPageDocumentGuard = z.object({
  demoChat: demoChatGuard,
  hero: heroGuard,
  fomo: fomoGuard,
  howItWorks: howItWorksGuard,
  agents: agentsGuard,
  platform: platformGuard,
  products: productsGuard,
  industries: industriesGuard,
  stories: storiesGuard,
  why: whyGuard,
  trust: trustGuard,
  closingCta: closingCtaGuard,
});

export type LandingPageDocument = z.infer<typeof landingPageDocumentGuard>;

export const landingPageResponseGuard = z.object({
  draft: landingPageDocumentGuard,
  published: landingPageDocumentGuard.nullable(),
  publishedVersion: z.number().int().positive().nullable(),
});

export type LandingPageResponse = z.infer<typeof landingPageResponseGuard>;
