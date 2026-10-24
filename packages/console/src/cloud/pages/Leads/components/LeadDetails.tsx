/* eslint-disable max-lines -- Keep the extracted detail markup and control order intact in this pure move. */
import {
  type LandingLead,
  type LandingLeadAssist,
  type LandingLeadTranscript,
} from '@/cloud/hooks/use-landing-leads';
import Button from '@/ds-components/Button';
import Card from '@/ds-components/Card';
import CardTitle from '@/ds-components/CardTitle';
import DangerousRaw from '@/ds-components/DangerousRaw';

import { leadStages } from '../stages';

import BudgetInsights from './BudgetInsights';
import styles from './LeadDetails.module.scss';
import Transcript from './Transcript';

export type KuboDemoRequest = {
  name: string;
  email: string;
  phase: string;
  tenant?: string | undefined;
};

export type LeadProfile = {
  budgetAssessment?: unknown;
  summary: string | undefined;
  sources: string[];
  tone: string | undefined;
  outcomes: string[];
  nextSteps: string[];
};

export type LeadDetailsProps = {
  readonly lead: LandingLead;
  readonly profile: LeadProfile;
  readonly transcript?: LandingLeadTranscript;
  readonly hasTranscriptFailed: boolean;
  readonly assist?: LandingLeadAssist;
  readonly isAssistLoading: boolean;
  readonly demoRequest?: KuboDemoRequest;
  readonly hasDemoFailed: boolean;
  readonly notes: string;
  readonly tags: string;
  readonly onNotesChange: (value: string) => void;
  readonly onTagsChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onStageChange: (status: string) => void;
  readonly onRunAssist: () => void;
  readonly onDecideDemo: (decision: 'approve' | 'reject') => void;
  readonly onDownloadBrief: () => void;
  readonly onDownloadSlides: () => void;
  readonly onBookMeeting?: () => void;
  readonly hasSaveFailed: boolean;
  readonly isSaving?: boolean;
  readonly hasFileFailed: boolean;
  readonly hasAssistFailed: boolean;
};

const readText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const readList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const readRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};

export const readProfile = (lead: LandingLead): LeadProfile => {
  const profile = readRecord(lead.companyProfile);
  const insight = readRecord(profile.conversation);

  return {
    ...(profile.budgetAssessment === undefined
      ? {}
      : { budgetAssessment: profile.budgetAssessment }),
    summary: readText(profile.summary),
    sources: readList(profile.sources),
    tone: readText(insight.tone),
    outcomes: readList(insight.outcomes),
    nextSteps: readList(insight.nextSteps),
  };
};

function NextActions({
  status,
  hasPendingDemo,
  nextSteps,
}: {
  readonly status: string;
  readonly hasPendingDemo: boolean;
  readonly nextSteps: string[];
}) {
  const cue = hasPendingDemo
    ? 'A demo request is waiting for a decision.'
    : status === 'new'
      ? 'Review this lead and choose a follow-up action.'
      : nextSteps.length > 0
        ? 'Conversation insights suggest covering the following topics.'
        : 'Choose an available follow-up action, or run AI lead assist for suggestions.';

  return (
    <div className={styles.section}>
      <p className={styles.heading}>Next actions</p>
      <p className={styles.muted}>{cue}</p>
      {nextSteps.length > 0 && (
        <ul>
          {nextSteps.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadDetails({
  lead,
  profile,
  transcript,
  hasTranscriptFailed,
  assist,
  isAssistLoading,
  demoRequest,
  hasDemoFailed,
  notes,
  tags,
  onNotesChange,
  onTagsChange,
  onSave,
  onStageChange,
  onRunAssist,
  onDecideDemo,
  onDownloadBrief,
  onDownloadSlides,
  onBookMeeting,
  hasSaveFailed,
  isSaving = false,
  hasFileFailed,
  hasAssistFailed,
}: LeadDetailsProps) {
  return (
    <Card className={styles.detailCard}>
      <CardTitle
        title={<DangerousRaw>Lead details</DangerousRaw>}
        subtitle={
          <DangerousRaw>
            {`${lead.lead.firstName} ${lead.lead.lastName}, ${lead.lead.company}`}
          </DangerousRaw>
        }
      />
      <div className={styles.section}>
        <p className={styles.heading}>Identity &amp; qualification</p>
        <div className={styles.facts}>
          <span>Email</span>
          <span>{lead.lead.email}</span>
          {lead.lead.role && (
            <>
              <span>Role</span>
              <span>{lead.lead.role}</span>
            </>
          )}
          {lead.lead.industry && (
            <>
              <span>Industry</span>
              <span>{lead.lead.industry}</span>
            </>
          )}
          {lead.lead.contactMethod && (
            <>
              <span>Preferred contact</span>
              <span>
                {lead.lead.contactMethod}
                {lead.lead.contactDetail ? `: ${lead.lead.contactDetail}` : ''}
              </span>
            </>
          )}
          {lead.lead.decision && (
            <>
              <span>Wants to see</span>
              <span>{lead.lead.decision}</span>
            </>
          )}
        </div>
      </div>

      <NextActions
        status={lead.status}
        hasPendingDemo={demoRequest?.phase === 'Pending'}
        nextSteps={profile.nextSteps}
      />

      <div className={styles.section}>
        <p className={styles.heading}>Existing actions</p>
        <label className={styles.field}>
          Pipeline status
          <select
            value={lead.status}
            disabled={isSaving}
            onChange={(event) => {
              onStageChange(event.target.value);
            }}
          >
            {leadStages.map((status) => (
              <option key={status} value={status}>
                {status.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.actions}>
          <Button
            type="outline"
            title={<DangerousRaw>AI lead assist</DangerousRaw>}
            isLoading={isAssistLoading}
            onClick={() => {
              onRunAssist();
            }}
          />
          <Button
            type="primary"
            title={<DangerousRaw>Download meeting brief (PDF)</DangerousRaw>}
            onClick={() => {
              onDownloadBrief();
            }}
          />
          <Button
            type="outline"
            title={<DangerousRaw>Download meeting slides (PPTX)</DangerousRaw>}
            onClick={() => {
              onDownloadSlides();
            }}
          />
          {onBookMeeting && (
            <Button
              type="outline"
              title={<DangerousRaw>Book a meeting</DangerousRaw>}
              onClick={() => {
                onBookMeeting();
              }}
            />
          )}
        </div>
      </div>
      {hasFileFailed && <p className={styles.notice}>The file could not be created.</p>}
      {hasSaveFailed && <p className={styles.notice}>Lead changes could not be saved.</p>}
      {isSaving && (
        <p role="status" className={styles.muted}>
          Saving lead changes…
        </p>
      )}
      {hasAssistFailed && (
        <p className={styles.notice}>
          AI assistance is unavailable. Check the AI configuration and try again.
        </p>
      )}
      {assist && (
        <div className={styles.section}>
          <p className={styles.heading}>AI lead assist · {assist.qualification} fit</p>
          <p>{assist.summary}</p>
          {assist.rationale.map((item) => (
            <p key={item}>{item}</p>
          ))}
          <p className={styles.heading}>Suggested next steps</p>
          <ul>
            {assist.suggestedNextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={styles.heading}>Follow-up draft (not sent)</p>
          <p>{assist.followUpDraft}</p>
        </div>
      )}
      {(() => {
        const request = demoRequest;

        return (
          <div className={styles.section}>
            <p className={styles.heading}>Demo request</p>
            {request ? (
              <>
                <p>
                  {request.name} · {request.phase}
                  {request.tenant ? ` · ${request.tenant}` : ''}
                </p>
                {request.phase === 'Pending' && (
                  <div className={styles.actions}>
                    <Button
                      type="primary"
                      title={<DangerousRaw>Approve demo</DangerousRaw>}
                      onClick={() => {
                        onDecideDemo('approve');
                      }}
                    />
                    <Button
                      type="outline"
                      title={<DangerousRaw>Reject demo</DangerousRaw>}
                      onClick={() => {
                        onDecideDemo('reject');
                      }}
                    />
                  </div>
                )}
              </>
            ) : (
              <p className={styles.muted}>No demo request for this lead yet.</p>
            )}
            {hasDemoFailed && <p className={styles.notice}>The decision could not be saved.</p>}
          </div>
        );
      })()}

      <div className={styles.section}>
        <div className={styles.field}>
          <label className={styles.heading} htmlFor="lead-tags">
            Tags
          </label>
          <input
            id="lead-tags"
            value={tags}
            placeholder="Separate tags with commas"
            onChange={(event) => {
              onTagsChange(event.target.value);
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.heading} htmlFor="lead-notes">
            Sales notes
          </label>
          <textarea
            id="lead-notes"
            value={notes}
            placeholder="Add notes..."
            rows={3}
            onChange={(event) => {
              onNotesChange(event.target.value);
            }}
          />
        </div>
        <div className={styles.actions}>
          <Button
            type="outline"
            title={<DangerousRaw>Save notes and tags</DangerousRaw>}
            isLoading={isSaving}
            onClick={() => {
              onSave();
            }}
          />
        </div>
        <p className={styles.heading}>Company</p>
        <p>{profile.summary ?? 'No company profile yet. The company website could not be read.'}</p>
        {profile.sources.length > 0 && (
          <p className={`${styles.muted} ${styles.wrappable}`}>
            Sources: {profile.sources.join(', ')}
          </p>
        )}
      </div>

      <BudgetInsights assessment={profile.budgetAssessment} />

      <div className={styles.section}>
        <p className={styles.heading}>Company &amp; conversation insights</p>
        <p className={styles.heading}>How the conversation went</p>
        <p>
          <strong>Tone:</strong> {profile.tone ?? 'not yet analysed'}
        </p>
        <p>
          <strong>Likely outcomes</strong>
        </p>
        {profile.outcomes.length > 0 ? (
          <ul>
            {profile.outcomes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Not yet analysed.</p>
        )}
        <p>
          <strong>Cover next</strong>
        </p>
        {profile.nextSteps.length > 0 && (
          <ul>
            {profile.nextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.section}>
        <p className={styles.heading}>Conversation</p>
        <Transcript messages={transcript} isFailed={hasTranscriptFailed} />
      </div>
    </Card>
  );
}

export default LeadDetails;
/* eslint-enable max-lines */
