import { defineConfig } from 'tinacms';

// This schema mirrors packages/schemas/src/types/landing-page.ts
// We keep the same structure so we can round-trip to the existing backend document.

const landingPageConfig = defineConfig({
  branch: 'main', // placeholder - we are not using Git backend primarily
  clientId: '', // not using Tina Cloud for now
  token: '',

  build: {
    outputFolder: 'admin',
    publicFolder: 'public',
  },

  media: {
    tina: {
      mediaRoot: '',
      publicFolder: 'public',
    },
  },

  schema: {
    collections: [
      {
        name: 'landingPage',
        label: 'Landing Page',
        path: 'content/landing', // placeholder path (we override with our API)
        format: 'json',
        ui: {
          // We will drive saves through our existing useLandingPage hook
          // instead of Tina's default file system.
        },
        fields: [
          {
            type: 'object',
            name: 'demoChat',
            label: 'Demo Chat',
            fields: [
              {
                type: 'boolean',
                name: 'enabled',
                label: 'Enabled',
                description: 'Turn the AI demo chat on or off on the live site',
              },
            ],
          },
          {
            type: 'object',
            name: 'hero',
            label: 'Hero',
            fields: [
              {
                type: 'string',
                name: 'lede',
                label: 'Intro text',
                required: true,
              },
              {
                type: 'object',
                name: 'primaryCta',
                label: 'Primary Button',
                fields: [
                  { type: 'string', name: 'label' },
                  { type: 'string', name: 'href' },
                ],
              },
              {
                type: 'object',
                name: 'secondaryCta',
                label: 'Secondary Button',
                fields: [
                  { type: 'string', name: 'label' },
                  { type: 'string', name: 'href' },
                ],
              },
              // headline as list for multi-line
              {
                type: 'object',
                name: 'headline',
                label: 'Headline Lines',
                list: true,
                fields: [{ type: 'string', name: 'line' }],
              },
              // add other hero fields as needed (proofLabel, storyLinkLabel)
            ],
          },
          // Add other sections (fomo, agents, products, etc.) in the same style.
          // For brevity in spike, start with hero + demoChat and expand.

          {
            type: 'object',
            name: 'fomo',
            label: 'Missing Layer (FOMO)',
            fields: [
              {
                type: 'string',
                name: 'pill',
                label: 'Pill',
              },
              // cells, heading, etc. can be added similarly
            ],
          },

          // TODO: Expand with full sections from landingPageDocumentGuard:
          // howItWorks, agents (array of cards), platform, products, industries,
          // stories, why, trust, closingCta, layout, copy (locale map)
        ],
      },
    ],
  },
});

export default landingPageConfig;
