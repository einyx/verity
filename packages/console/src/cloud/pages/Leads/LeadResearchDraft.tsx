import { useState } from 'react';

import type {
  LandingLead,
  LandingLeadResearch,
  LeadResearchProvider,
} from '@/cloud/hooks/use-landing-leads';
import Button from '@/ds-components/Button';
import DangerousRaw from '@/ds-components/DangerousRaw';

import styles from './LeadResearchDraft.module.scss';

type Props = {
  readonly lead: LandingLead;
  readonly onResearch: (
    sessionId: string,
    provider: LeadResearchProvider
  ) => Promise<LandingLeadResearch>;
};

function LeadResearchDraft({ lead, onResearch }: Props) {
  const [research, setResearch] = useState<LandingLeadResearch>();
  const [isResearching, setIsResearching] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [provider, setProvider] = useState<LeadResearchProvider>('claude');
  const providerName = provider === 'claude' ? 'Claude Code' : 'AutoClaw';

  const runResearch = async () => {
    setHasError(false);
    setResearch(undefined);
    setIsResearching(true);

    try {
      setResearch(await onResearch(lead.sessionId, provider));
    } catch {
      setHasError(true);
    } finally {
      setIsResearching(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="lead-research-heading">
      <p className={styles.heading} id="lead-research-heading">
        LinkedIn research and draft
      </p>
      <p className={styles.muted}>
        Research sends limited profile fields to the configured provider, which may be remote. Use
        only an approved provider. Results are model-generated: verify sources before use. Research
        and drafts are not saved to the lead or sent as messages; provider retention may differ.
      </p>
      <label className={styles.researchField}>
        <span>Research provider</span>
        <select
          value={provider}
          onChange={({ currentTarget: { value } }) => {
            if (value === 'autoclaw' || value === 'claude') {
              setProvider(value);
            }
          }}
        >
          <option disabled value="autoclaw">
            AutoClaw (bridge contract required)
          </option>
          <option value="claude">Claude Code</option>
        </select>
      </label>
      <div className={styles.actions}>
        <Button
          type="primary"
          title={
            <DangerousRaw>
              {isResearching ? 'Researching…' : `Research with ${providerName}`}
            </DangerousRaw>
          }
          isLoading={isResearching}
          onClick={() => {
            void runResearch();
          }}
        />
      </div>
      {hasError && (
        <p className={styles.notice} role="alert">
          {providerName} research failed. Check that its local bridge is running and configured,
          then try again.
        </p>
      )}
      {research && (
        <>
          <div className={styles.researchFindings}>
            <p className={styles.heading}>Research findings</p>
            {research.findings.length > 0 ? (
              <ul>
                {research.findings.map((finding) => (
                  <li key={`${finding.sourceUrl}-${finding.retrievedAt}`}>
                    <span>{finding.summary}</span>{' '}
                    <a href={finding.sourceUrl} target="_blank" rel="noopener noreferrer">
                      Source
                    </a>{' '}
                    <span className={styles.muted}>
                      Retrieved {new Date(finding.retrievedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>No source-backed findings were returned.</p>
            )}
          </div>
          <label className={styles.researchField}>
            <span>Outreach draft</span>
            <textarea readOnly aria-label="Outreach draft" value={research.draft} rows={7} />
            <small className={styles.muted}>Draft only — not sent or saved.</small>
          </label>
        </>
      )}
    </section>
  );
}

export default LeadResearchDraft;
