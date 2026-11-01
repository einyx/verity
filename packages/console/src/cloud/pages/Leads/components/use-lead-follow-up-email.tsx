import { isSyntheticLandingLead } from '@logto/schemas';
import { useRef, useState, type ReactNode } from 'react';

import {
  type LandingLead,
  type LandingLeadAssist,
  type LandingLeadEmailDraft,
  type LandingLeadEmailAcceptance,
} from '@/cloud/hooks/use-landing-leads';
import { isDevFeaturesEnabled } from '@/consts/env';

import FollowUpEmailReview from './FollowUpEmailReview';
import styles from './LeadDetails.module.scss';

export function useLeadFollowUpEmail({
  lead,
  assist,
  onSend,
}: {
  readonly lead: LandingLead;
  readonly assist?: LandingLeadAssist;
  readonly onSend?: (draft: LandingLeadEmailDraft) => Promise<LandingLeadEmailAcceptance>;
}): { action?: ReactNode; notice?: ReactNode; composer?: ReactNode } {
  const [isOpen, setIsOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // Reviewed lead follow-up emailing is a development feature; opening a draft never sends it.
  if (!isDevFeaturesEnabled || !onSend) {
    return {};
  }
  const allowed =
    lead.lead.consent === true &&
    (!lead.lead.contactMethod || lead.lead.contactMethod === 'email') &&
    !isSyntheticLandingLead({
      email: lead.lead.email,
      profile: lead.companyProfile,
      tags: lead.tags,
    });
  return {
    action: (
      <button
        ref={button}
        type="button"
        className={styles.emailAction}
        disabled={!allowed}
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Send email
      </button>
    ),
    notice: !allowed && (
      <p className={styles.muted}>
        Email follow-up requires email contact consent and is unavailable for demo data.
      </p>
    ),
    composer: isOpen && (
      <FollowUpEmailReview
        key={lead.sessionId}
        recipient={lead.lead.email}
        initialText={assist?.followUpDraft ?? ''}
        onSend={onSend}
        onClose={() => {
          setIsOpen(false);
          button.current?.focus();
        }}
      />
    ),
  };
}
