import classNames from 'classnames';
import { useState } from 'react';
import { Helmet } from 'react-helmet';

import {
  type LandingLead,
  type LandingLeadTranscript,
  useLandingLeads,
} from '@/cloud/hooks/use-landing-leads';

import styles from './index.module.scss';

// Leads from the landing demo chat, for the sales team. Read-only: contact details and conversations are
// shown to cloud admins only, and a conversation is loaded when its lead is opened. Plain English on
// purpose, like the landing page editor, because the page is behind the dev-feature flag.

const formatDate = (value: LandingLead['createdAt']) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const emailStatusLabel: Record<string, string> = {
  sent: 'Sent',
  failed: 'Failed',
  pending: 'Pending',
};

const readText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const readList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The company summary and chat insight stored on a lead. Anything that does not match is left out. */
const readProfile = (lead: LandingLead) => {
  const profile = lead.companyProfile ?? {};
  const { conversation } = profile;
  const insight = typeof conversation === 'object' && conversation !== null ? conversation : {};

  return {
    summary: readText(profile.summary),
    sources: readList(profile.sources),
    tone: readText((insight as Record<string, unknown>).tone),
    outcomes: readList((insight as Record<string, unknown>).outcomes),
    nextSteps: readList((insight as Record<string, unknown>).nextSteps),
  };
};

const bookingLinkFor = (base: string, email: string) =>
  `${base}${base.includes('?') ? '&' : '?'}email=${encodeURIComponent(email)}`;

function EmailStatus({ value }: { readonly value: string }) {
  return (
    <span
      className={classNames(
        styles.badge,
        value === 'sent' && styles.badgeSuccess,
        value === 'failed' && styles.badgeError
      )}
    >
      {emailStatusLabel[value] ?? value}
    </span>
  );
}

function Transcript({
  messages,
  isFailed,
}: {
  readonly messages?: LandingLeadTranscript;
  readonly isFailed: boolean;
}) {
  if (isFailed) {
    return <p className={styles.notice}>The conversation could not be loaded.</p>;
  }

  if (!messages) {
    return <p className={styles.muted}>Loading conversation…</p>;
  }

  if (messages.length === 0) {
    return <p className={styles.muted}>This conversation has no messages.</p>;
  }

  return (
    <div className={styles.messages}>
      {messages.map((message, index) => (
        <div
          // The transcript is read-only and never reordered, so the position is a stable key.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          className={classNames(
            styles.message,
            message.role === 'user' ? styles.messageVisitor : styles.messageAssistant
          )}
        >
          <span className={styles.messageRole}>
            {message.role === 'user' ? 'Visitor' : 'Assistant'}
          </span>
          <span>{message.content}</span>
        </div>
      ))}
    </div>
  );
}

function Leads() {
  const { leads, bookingUrl, error, isLoading, loadTranscript, loadBriefPdf } = useLandingLeads();
  const [briefFailed, setBriefFailed] = useState(false);
  const [openedId, setOpenedId] = useState<string>();
  const [transcript, setTranscript] = useState<LandingLeadTranscript>();
  const [transcriptFailed, setTranscriptFailed] = useState(false);

  const openLead = async (lead: LandingLead) => {
    setOpenedId(lead.id);
    setTranscript(undefined);
    setTranscriptFailed(false);

    try {
      setTranscript(await loadTranscript(lead.sessionId));
    } catch {
      setTranscriptFailed(true);
    }
  };

  const opened = leads?.find((lead) => lead.id === openedId);
  const count = leads?.length ?? 0;

  return (
    <div className={styles.container}>
      <Helmet title="Leads" />

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Leads</h1>
          <p className={styles.subtitle}>
            Visitors who asked the landing page chat to be contacted. Open a lead to read its
            conversation.
          </p>
        </div>
        {leads && <span className={styles.count}>{count} total</span>}
      </header>

      {isLoading && <p className={styles.muted}>Loading leads…</p>}

      {error && (
        <div className={styles.card}>
          <p className={styles.notice}>Leads could not be loaded. Try again in a moment.</p>
        </div>
      )}

      {leads && count === 0 && (
        <div className={styles.card}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No leads yet</p>
            <p className={styles.muted}>
              When a visitor asks the landing page chat to be contacted, their lead appears here.
            </p>
          </div>
        </div>
      )}

      {leads && count > 0 && (
        <div className={classNames(styles.layout, opened && styles.layoutWithDetail)}>
          <div className={styles.card}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Email status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className={classNames(styles.row, openedId === lead.id && styles.rowSelected)}
                    tabIndex={0}
                    aria-selected={openedId === lead.id}
                    onClick={() => {
                      void openLead(lead);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void openLead(lead);
                      }
                    }}
                  >
                    <td className={styles.strong}>
                      {`${lead.lead.firstName} ${lead.lead.lastName}`}
                    </td>
                    <td>{lead.lead.company}</td>
                    <td>{lead.lead.email}</td>
                    <td>
                      <EmailStatus value={lead.emailStatus} />
                    </td>
                    <td className={styles.muted}>{formatDate(lead.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {opened && (
            <aside className={styles.card} aria-label="Lead details">
              <div className={styles.detailHeader}>
                <div>
                  <p
                    className={styles.strong}
                  >{`${opened.lead.firstName} ${opened.lead.lastName}`}</p>
                  <p className={styles.muted}>{opened.lead.company}</p>
                </div>
                <button
                  type="button"
                  className={styles.close}
                  aria-label="Close lead details"
                  onClick={() => {
                    setOpenedId(undefined);
                  }}
                >
                  Close
                </button>
              </div>

              <dl className={styles.facts}>
                <dt>Email</dt>
                <dd>{opened.lead.email}</dd>
                {opened.lead.role && (
                  <>
                    <dt>Role</dt>
                    <dd>{opened.lead.role}</dd>
                  </>
                )}
                {opened.lead.industry && (
                  <>
                    <dt>Industry</dt>
                    <dd>{opened.lead.industry}</dd>
                  </>
                )}
                {opened.lead.contactMethod && (
                  <>
                    <dt>Preferred contact</dt>
                    <dd>
                      {opened.lead.contactMethod}
                      {opened.lead.contactDetail ? `: ${opened.lead.contactDetail}` : ''}
                    </dd>
                  </>
                )}
                {opened.lead.decision && (
                  <>
                    <dt>Decision</dt>
                    <dd>{opened.lead.decision}</dd>
                  </>
                )}
              </dl>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    void loadBriefPdf(opened.sessionId)
                      .then((blob) => {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `meeting-brief-${opened.sessionId}.pdf`;
                        link.click();
                        URL.revokeObjectURL(url);
                        setBriefFailed(false);
                      })
                      .catch(() => {
                        setBriefFailed(true);
                      });
                  }}
                >
                  Download meeting brief (PDF)
                </button>
                {bookingUrl && (
                  <a
                    className={styles.secondary}
                    href={bookingLinkFor(bookingUrl, opened.lead.email)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Book a meeting
                  </a>
                )}
              </div>
              {briefFailed && <p className={styles.notice}>The brief could not be created.</p>}

              <h2 className={styles.sectionTitle}>Company</h2>
              {(() => {
                const profile = readProfile(opened);

                return (
                  <div className={styles.insight}>
                    <p>
                      {profile.summary ??
                        'No company profile yet. The company website could not be read.'}
                    </p>
                    {profile.sources.length > 0 && (
                      <p className={styles.muted}>Sources: {profile.sources.join(', ')}</p>
                    )}
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
                );
              })()}

              <h2 className={styles.sectionTitle}>Conversation</h2>
              <Transcript messages={transcript} isFailed={transcriptFailed} />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

export default Leads;
