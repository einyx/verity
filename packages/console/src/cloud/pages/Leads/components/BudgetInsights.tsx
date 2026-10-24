import { z } from 'zod';

import styles from './LeadDetails.module.scss';

// Internal service response contract only; no model/provider code or credentials in the console.
const notes = z.array(z.string().trim().min(1).max(1000)).max(12);
const assessmentGuard = z.object({
  currency: z.literal('USD'),
  demoMonthly: z.literal(150),
  bankAnnualPlanningAnchor: z.literal(1_500_000),
  bankPeriodAssumption: z.literal('annual, unconfirmed'),
  opportunityBudgetStatus: z.literal('not_disclosed'),
  indicativeAnnualRange: z
    .object({
      low: z.number().finite().nonnegative(),
      base: z.number().finite().nonnegative(),
      high: z.number().finite().nonnegative(),
    })
    .refine(({ low, base, high }) => low <= base && base <= high)
    .nullable(),
  confidence: z.enum(['low', 'medium']),
  assessedAt: z.string().datetime(),
  rationale: notes,
  assumptions: notes,
  discoveryQuestions: notes,
  evidence: z
    .array(
      z.object({
        sourceUrl: z.string().max(2048),
        quote: z.string().trim().min(1).max(3000),
        signal: z.string().trim().min(1).max(500),
      })
    )
    .max(12),
});

const safeSourceUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    // Malformed evidence remains plain text, never a navigation target.
  }
};

const usd = (value: number) => `USD ${value.toLocaleString('en-US')}`;

function BudgetInsights({ assessment }: { readonly assessment?: unknown }) {
  const parsed = assessmentGuard.safeParse(assessment);
  const budget = parsed.success ? parsed.data : undefined;
  const range = budget?.indicativeAnnualRange;

  return (
    <section className={styles.section} aria-label="Internal budget advisory">
      <p className={styles.heading}>Budget advisory · internal only</p>
      <div className={styles.facts}>
        <span>Demo reference</span>
        <span>USD 150/month</span>
        <span>Actual opportunity budget</span>
        <span>Not disclosed</span>
      </div>
      <p className={styles.muted}>
        Bank planning anchor: USD 1,500,000/year — UNCONFIRMED annual assumption, not an
        observation.
      </p>
      <p>
        AI advisory vendor pricing scenarios · annual USD; not the customer’s confirmed budget or a
        binding quote.
      </p>
      {!budget && <p className={styles.muted}>No valid budget assessment yet.</p>}
      {budget && (
        <>
          <p className={styles.muted}>
            Confidence: {budget.confidence} · Assessed: {budget.assessedAt}
          </p>
          {range ? (
            <div className={styles.facts}>
              <span>Annual low</span>
              <span>{usd(range.low)}</span>
              <span>Annual base</span>
              <span>{usd(range.base)}</span>
              <span>Annual high</span>
              <span>{usd(range.high)}</span>
            </div>
          ) : (
            <p className={styles.muted}>Insufficient evidence or scope for a range.</p>
          )}
          {(
            [
              ['Rationale', budget.rationale],
              ['Assumptions', budget.assumptions],
              ['Discovery questions', budget.discoveryQuestions],
            ] as const
          ).map(
            ([label, items]) =>
              items.length > 0 && (
                <div key={label}>
                  <p className={styles.heading}>{label}</p>
                  <ul>
                    {items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )
          )}
          {budget.evidence.length > 0 && (
            <div>
              <p className={styles.heading}>Public context evidence · not confirmed funding</p>
              {budget.evidence.map(({ sourceUrl, quote, signal }) => {
                const href = safeSourceUrl(sourceUrl);
                return (
                  <blockquote key={`${sourceUrl}:${quote}`}>
                    <p>{quote}</p>
                    <p>{signal}</p>
                    {href && (
                      <a
                        className={styles.wrappable}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {sourceUrl}
                      </a>
                    )}
                  </blockquote>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default BudgetInsights;
