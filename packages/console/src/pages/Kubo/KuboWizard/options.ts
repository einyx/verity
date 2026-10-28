// Stack choices offered by the Kubo create wizard, and the components each one leaves out.
export type StackOption = {
  id: 'foundation' | 'dai' | 'fai' | 'v1';
  title: string;
  description: string;
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
    description: 'The complete platform: high-availability database and Trino catalog.',
    template: 'full',
    exclude: [],
    available: true,
  },
  {
    id: 'dai',
    title: 'Dashboards AI',
    description: 'Just the AI dashboard components and their database.',
    template: 'full',
    exclude: daiExcluded,
    available: true,
  },
  {
    id: 'fai',
    title: 'Foundation AI',
    description: 'Only the foundation-ai component.',
    template: 'full',
    exclude: faiExcluded,
    available: true,
  },
  {
    id: 'v1',
    title: 'V1',
    description:
      'The v1.ai demo: Vite client and Node server on Postgres. Needs the v1-demo-secrets Secret in the tenant namespace before it deploys.',
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
  foundation: { tags: ['Full platform', 'High availability', 'Trino catalog'], recommended: true },
  dai: { tags: ['AI dashboards', 'Smaller setup'] },
  fai: { tags: ['foundation-ai only', 'Smaller setup'] },
  v1: { tags: ['v1.ai demo', 'Standalone', 'Postgres'] },
};
