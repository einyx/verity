import { type LandingPageDocument } from './landing-page.js';

const demo = '/demo?intent=demo';

/** The copy the site ships with. Used until a document is published, and as the first draft. */
const defaultSections = {
  demoChat: { enabled: true },
  hero: {
    headline: ['Enterprise', 'intelligence', 'that compounds.'],
    lede: 'The intelligence layer sits between your data and your AI. It captures the context, expertise and decisions your people create every day, so every answer, app and agent gets smarter the more your business uses it.',
    primaryCta: { label: 'Request a Demo', href: demo },
    secondaryCta: { label: 'See the platform', href: '#platform' },
    tertiaryCta: { label: 'Try', href: 'https://try.meshx.foundation' },
    proofLabel: 'Trusted by teams at',
    storyLinkLabel: 'Read the Velora story',
    storyLinkHref: '#stories',
  },
  fomo: {
    heading: ['Every company has an AI mandate.', ' This is the missing layer.'],
    pill: 'Intelligence layer',
    cells: [
      { heading: 'Expertise', body: 'Knows what your best people know.' },
      { heading: 'Context', body: 'Explains what it means in your organization.' },
      { heading: 'Knowledge', body: 'Captures how your people operate.' },
      { heading: 'Decision history', body: 'Shows AI which actions matter, and why.' },
    ],
    foundationLabel: 'Foundation AI',
    definition:
      'Intelligence is what your business knows that no system records, captured as people work and used to make every next answer better.',
  },
  howItWorks: {
    heading: ['Every cycle adds context.', 'Every answer compounds.'],
    lede: 'Intelligence builds in the background as people work. Nobody fills in forms, curates a wiki or changes how they work.',
    cta: { label: 'See the platform', href: '#platform' },
  },
  agents: {
    heading: ['You have agents.', 'Now make them trustworthy.'],
    lede: 'Foundation AI sits behind every agent and question as a single governed intelligence source your enterprise owns.',
    cta: { label: 'See the platform', href: '#platform' },
    cards: [
      {
        role: 'Business users & analysts',
        title: 'Ask your enterprise',
        body: 'Get sourced, permission-aware answers across every system, whether the question comes from Copilot, Dashboards.AI or a custom app. Turn any answer into a live tile.',
        quote: 'How many Abu Dhabi arrivals are delayed today, and why?',
      },
      {
        role: 'Operations experts',
        title: 'Capture know-how',
        body: 'Keep the expertise nobody wrote down, along with the context and decisions behind it. Corrected procedures become reusable skills for the whole organization.',
        quote: 'How do we price ground handling for a new carrier at AUH?',
      },
      {
        role: 'Every employee',
        title: 'Agents that learn from you',
        body: "Each user's agent starts empty and learns from every interaction. It spots repeated questions and offers to automate them, within that user's permissions.",
        quote: 'You ask about cargo tonnage every Monday. Want this sent to you each week?',
      },
      {
        role: 'Duty & ops managers',
        title: 'Run the operation',
        body: 'Spot crew shortfalls and SLA risk early, weigh the trade-offs, and act. Every human override teaches the system what good looks like.',
        quote: "Which freighter should we prioritize if we're three crew short?",
      },
      {
        role: 'COO & executive team',
        title: 'Plan with what-ifs',
        body: 'Go beyond reporting to scenario planning, showing sources and confidence levels. See what pulling one lever does to the rest of the business.',
        quote: 'If we add a shift at peak, what happens to turnaround time?',
      },
      {
        role: 'AI & agents',
        title: 'Connect AI to your intelligence',
        body: 'Give Copilot, Claude or ChatGPT one well-informed tool in place of dozens of confusing ones. Foundation AI handles routing, context and permissions underneath, so answers are faster and more consistent.',
        quote: 'What does this data mean, where does it live, and who is allowed to see it?',
      },
    ],
  },
  platform: {
    kicker: 'Platform architecture',
    heading: ['The layer between', 'your data and your agents.'],
    lede: 'Foundation AI sits on the data platforms you already run and behind the tools your people already use. Models plug in from outside; your context stays in the layer.',
    rentedLabel: 'Rented models',
    footnote:
      'Connect to Foundation AI only. Replace any of them without losing the context your layer holds.',
  },
  products: {
    kicker: 'Products',
    heading: ['Every product', 'makes the others smarter.'],
    lede: 'Questions in Dashboards.AI and apps built in V1.AI teach Foundation AI, and Foundation AI makes every answer and app better in return.',
    products: [
      {
        name: 'Foundation AI',
        badge: 'Core platform',
        tagline: 'The intelligence layer',
        body: 'Orchestration, an enterprise graph, memory, personal agents, model routing and central AI policy. It works with any data platform and any MCP-compatible AI tool.',
        ctaLabel: 'Request a Demo',
        ctaHref: '/demo?interest=foundation-ai',
      },
      {
        name: 'Dashboards.AI',
        badge: 'For business users',
        tagline: 'Answers, insights and always-on visibility',
        body: 'Ask in plain language, then pin the answer as a live tile. Summarize a whole dashboard in one step. Some things are best seen at a glance.',
        ctaLabel: 'Explore Dashboards.AI',
        ctaHref: 'https://dashboards.ai/',
      },
      {
        name: 'V1.AI',
        badge: 'Coming soon',
        tagline: 'Build apps and agents by conversation',
        body: 'Describe the app you need and V1.AI checks the data is there before it builds. Deploy agents straight into Dashboards.AI to monitor and act.',
        ctaLabel: 'Request a Demo',
        ctaHref: '/demo?interest=v1',
      },
      {
        name: 'Foundation Data',
        badge: 'Data platform',
        tagline: 'Governed data, live in production',
        body: 'Catalog, lineage, data quality and data sharing for organizations that need a managed data foundation, or that sit alongside Databricks and Snowflake.',
        ctaLabel: 'Explore Foundation Data',
        ctaHref: 'https://meshx.foundation/',
      },
    ],
  },
  industries: {
    kicker: 'Industries',
    heading: ['Expert intelligence,', 'industry by industry.'],
    lede: 'We work with the biggest operators in each sector to build up domain intelligence that every participant can use.',
    industries: [
      {
        name: 'Aviation',
        badge: 'Live',
        tag: 'AUH · ETD · IATA',
        body: 'A governed intelligence network for airports, airlines and ground handlers. Each party decides what to share, with whom and how often.',
        bullets: [
          'Turnaround efficiency',
          'Weather-driven disruption management',
          'Workforce and role competence',
        ],
        ctaLabel: 'Discuss aviation',
        ctaHref: '/demo?industry=aviation',
      },
      {
        name: 'Smart cities',
        badge: 'Live',
        tag: 'GIGA-PROJECTS',
        body: 'One governed data network across the sectors that build and run a city. Each sector owns its data and chooses what to share.',
        bullets: [
          'Data products shared between sectors',
          'Construction and project reporting',
          'Mobility, utilities and tourism insight',
        ],
        ctaLabel: 'Discuss smart cities',
        ctaHref: '/demo?industry=smart-cities',
      },
    ],
  },
  stories: {
    kicker: 'Already compounding',
    heading: 'Success stories',
    story: {
      customer: 'Velora',
      sector: 'Aviation · Ground handling',
      headline: 'Velora: from a governed data foundation to enterprise intelligence.',
      body: 'Velora runs meshX Foundation in production as the source of truth behind its enterprise Copilot. The next step is intelligence that learns how its people run the operation.',
      ctaLabel: 'Discuss your use case',
      ctaHref: '#demo-chat',
    },
    facts: [
      {
        label: 'Challenge',
        body: 'Data spread across SAP, SharePoint and operational systems, with Copilot needing one trusted source.',
      },
      {
        label: 'Solution',
        body: 'Foundation Data as the governed platform, connected to Microsoft Copilot through MCP.',
      },
      {
        label: 'Intelligence',
        body: 'Foundation AI, so any question gets a consistent, sourced answer that improves with use.',
      },
      {
        label: 'Surfaces',
        body: 'Dashboards.AI, Power BI and Copilot draw on the same governed intelligence, so every tool gives the same answer.',
      },
    ],
  },
  why: {
    kicker: 'Why meshX',
    heading: ['Rent the model.', 'Own your intelligence.'],
    reasons: [
      {
        label: 'It compounds',
        heading: 'Smarter every day',
        body: 'Every question, correction and decision adds context. The system is more valuable in month six than on day one, and the lead keeps growing.',
      },
      {
        label: "It's yours",
        heading: 'Independent of any model',
        body: 'Your context, memory and expertise stay in a layer you control. Swap LLMs as the market changes without losing anything.',
      },
      {
        label: 'It connects',
        heading: 'No rip and replace',
        body: 'Plugs into the data platforms you already run and the AI tools your people already use. One governed intelligence behind all of them.',
      },
    ],
    rows: [
      {
        have: 'Databricks, Snowflake or Fabric',
        add: 'A learning intelligence layer on top of the platform you already run, with no migration.',
      },
      {
        have: 'Microsoft Copilot',
        add: 'Enterprise context, routing and permissions, so Copilot gives consistent, sourced answers in place of guesses.',
      },
      {
        have: 'Enterprise search',
        add: 'Verified lineage, governed business logic, and intelligence that improves with use rather than an index that stays the same.',
      },
      {
        have: 'An in-house AI team',
        add: 'A shared brain, so each new agent starts with everything the business already knows.',
      },
    ],
  },
  trust: {
    kicker: 'Security & governance',
    heading: 'Governed from the first question.',
    commitments: [
      {
        heading: 'Your data stays put',
        body: 'Foundation AI reads through to your platforms. Raw data is never copied into the intelligence layer.',
      },
      {
        heading: 'Policy before ingestion',
        body: 'Nothing is captured without a policy. Every AI surface follows the same central guardrails.',
      },
      {
        heading: 'Permission-aware',
        body: 'Answers and agents follow the same roles and access rules as the underlying data.',
      },
      {
        heading: 'Deploy your way',
        body: 'Run it in our cloud, your cloud, or air-gapped with a trusted control plane.',
      },
    ],
  },
  closingCta: {
    heading: 'Start building intelligence your business owns.',
    body: "Pick one operational decision. We'll show you what Foundation AI does with it, and how it compounds from there.",
    primaryLabel: 'Request a Demo',
    primaryHref: '#demo-chat',
    secondaryLabel: 'Discuss your use case',
    secondaryHref: '#demo-chat',
  },
};

/** The shipped page expressed using the same ordered block contract used by the CMS API. */
export const defaultLandingPageContent: LandingPageDocument = {
  demoChat: defaultSections.demoChat,
  sections: [
    { id: 'hero', type: 'hero', ...defaultSections.hero },
    { id: 'fomo', type: 'fomo', ...defaultSections.fomo },
    { id: 'how-it-works', type: 'howItWorks', ...defaultSections.howItWorks },
    { id: 'agents', type: 'agents', ...defaultSections.agents },
    { id: 'platform', type: 'platform', ...defaultSections.platform },
    { id: 'products', type: 'products', ...defaultSections.products },
    { id: 'industries', type: 'industries', ...defaultSections.industries },
    { id: 'stories', type: 'stories', ...defaultSections.stories },
    { id: 'why', type: 'why', ...defaultSections.why },
    { id: 'trust', type: 'trust', ...defaultSections.trust },
    { id: 'closing-cta', type: 'closingCta', ...defaultSections.closingCta },
  ],
};
