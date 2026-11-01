import { type LandingLeadAssist } from '@/cloud/hooks/use-landing-leads';
import { isDevFeaturesEnabled } from '@/consts/env';

import styles from './LeadDetails.module.scss';
import { formatFollowUpDraft, followUpParagraphs } from './follow-up-format';

export default function LeadAssistPanel({ assist }: { readonly assist: LandingLeadAssist }) {
  return (
    <div className={styles.section}>
      <p className={styles.heading}>AI lead assist · {assist.qualification} fit</p>
      <p>{assist.summary}</p>
      {/* Structured paragraphs and rationale lists accompany the reviewed follow-up email feature. */}
      {isDevFeaturesEnabled ? (
        <ul>
          {assist.rationale.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        assist.rationale.map((item) => <p key={item}>{item}</p>)
      )}
      <p className={styles.heading}>Suggested next steps</p>
      <ul>
        {assist.suggestedNextSteps.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className={styles.heading}>Follow-up draft (not sent)</p>
      {isDevFeaturesEnabled ? (
        <div className={styles.followUpParagraphs}>
          {followUpParagraphs(formatFollowUpDraft(assist.followUpDraft)).map((paragraph, index) => (
            // eslint-disable-next-line react/no-array-index-key -- Static plain-text paragraphs have no per-item state and may intentionally repeat.
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      ) : (
        <p>{assist.followUpDraft}</p>
      )}
    </div>
  );
}
