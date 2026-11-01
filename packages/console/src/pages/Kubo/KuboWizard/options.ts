// Stack choices offered by the Kubo create wizard, and the components each one leaves out.
export type StackOption = {
  id: 'foundation' | 'dai' | 'fai' | 'v1';
  title: string;
  description: string;
  setupRequirement?: string;
  template?: string;
  exclude: string[];
  available: boolean;
};

const faiExcluded = [
  'backend',
  'frontend',
  'opa',
  'postgres',
  'processor',
  'scheduler',
  'storage-engine',
  'trino',
  'dai-backend',
  'dai-frontend',
  'watcher',
  'foundation-bootstrap',
  'hive-metastore',
];

const daiExcluded = [
  'backend',
  'frontend',
  'opa',
  'processor',
  'scheduler',
  'storage-engine',
  'trino',
  'ai',
  'watcher',
  'foundation-bootstrap',
  'hive-metastore',
];

export const stackOptions: StackOption[] = [
  {
    id: 'foundation',
    title: 'Foundation',
    description: 'Manage business data, analytics, and AI in one complete workspace.',
    template: 'full',
    exclude: [],
    available: true,
  },
  {
    id: 'dai',
    title: 'Dashboards AI',
    description: 'Explore business data and turn questions into insights and dashboards.',
    template: 'full',
    exclude: daiExcluded,
    available: true,
  },
  {
    id: 'fai',
    title: 'Foundation AI',
    description: 'Add AI capabilities to your existing data and applications.',
    template: 'full',
    exclude: faiExcluded,
    available: true,
  },
  {
    id: 'v1',
    title: 'V1 demo',
    description: 'Evaluate the V1 app-building experience in a standalone demo workspace.',
    setupRequirement:
      'An administrator must configure the deployment credentials (v1-demo-secrets) in the workspace namespace before this demo can launch.',
    template: 'v1',
    exclude: [],
    available: true,
  },
];

// Every component a stack can contain. A stack's card lists the ones its `exclude` does not remove.
const allComponents = [
  'ai',
  'backend',
  'dai-backend',
  'dai-frontend',
  'foundation-bootstrap',
  'frontend',
  'hive-metastore',
  'opa',
  'postgres',
  'processor',
  'scheduler',
  'storage-engine',
  'trino',
  'watcher',
];

// Unavailable stacks have no components to show, so their card lists none.
const includedComponents = (option: Pick<StackOption, 'available' | 'exclude'>) =>
  option.available ? allComponents.filter((component) => !option.exclude.includes(component)) : [];

// Maps a 1-based list position onto the three wizard steps.
export const toStep = (value: number): 1 | 2 | 3 => {
  if (value >= 3) {
    return 3;
  }

  return value <= 1 ? 1 : 2;
};

// Short labels and the default pick, shown next to each template card.
export const templateHighlights: Record<
  StackOption['id'],
  { tags: string[]; recommended?: boolean }
> = {
  foundation: { tags: ['Data platform', 'Analytics', 'AI ready'], recommended: true },
  dai: { tags: ['Business insights', 'AI dashboards'] },
  fai: { tags: ['AI integration', 'Existing platforms'] },
  v1: { tags: ['App creation', 'Product demo'] },
};
