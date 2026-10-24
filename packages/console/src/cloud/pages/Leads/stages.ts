export const leadStages = [
  'new',
  'contacted',
  'qualified',
  'demo_requested',
  'approved',
  'provisioned',
  'closed',
  'rejected',
] as const;

export type LeadStage = (typeof leadStages)[number];

/** The stages a lead moves through, in order. */
export const pipelineStages: readonly LeadStage[] = [
  'new',
  'contacted',
  'qualified',
  'demo_requested',
  'approved',
  'provisioned',
];

/** The stages a lead leaves the pipeline in. */
export const closedStages: readonly LeadStage[] = ['closed', 'rejected'];

/** Display known labels and preserve unknown identifiers apart from capitalisation. */
export const stageLabel = (stage: string): string =>
  stage === 'demo_requested' ? 'Demo requested' : stage.charAt(0).toUpperCase() + stage.slice(1);
