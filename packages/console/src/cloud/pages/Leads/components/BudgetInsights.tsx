import { z } from 'zod/v3';

import styles from './LeadDetails.module.scss';

// Internal service response contract only; no model/provider code or credentials in the console.
// The panel publishes the budget status, a hypothetical suggestion and the discovery questions.
// Budget figures, scenario ranges, confidence ratings and assessment dates stay unpublished.
const notes = z.array(z.string().trim().min(1).max(1000)).max(12);
const assessmentGuard = z.object({
  opportunityBudgetStatus: z.literal('not_disclosed'),
  discoveryQuestions: notes.default([]),
  evidence: z
    .array(
      z.object({
        sourceUrl: z.string().max(2048),
        quote: z.string().trim().min(1).max(3000),
        signal: z.string().trim().min(1).max(500),
      })
    )
    .max(12)
    .default([]),
});

const safeSourceUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    // Malformed evidence remains plain text, never a navigation target.
  }
};

function BudgetInsights({ assessment }: { readonly assessment?: unknown }) {
  const parsed = assessmentGuard.safeParse(assessment);
  const budget = parsed.success ? parsed.data : undefined;

  return (
    <section className={styles.section} aria-label="Internal budget context">
      <p className={styles.heading}>Budget context · internal only</p>
      <div className={styles.facts}>
        <span>Actual opportunity budget</span>
        <span>Not disclosed</span>
      </div>
      <p className={styles.muted}>
        Hypothetical suggestion for sales: explore pricing as a scenario in discovery, confirm the
        customer’s actual budget and scope, then quote only against what they confirm. No budget
        figure is asserted here.
      </p>
      {!budget && <p className={styles.muted}>No valid budget assessment yet.</p>}
      {budget && budget.discoveryQuestions.length > 0 && (
        <div>
          <p className={styles.heading}>Discovery questions</p>
          <ul>
            {budget.discoveryQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}
      {budget && budget.evidence.length > 0 && (
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
    </section>
  );
}

export default BudgetInsights;
