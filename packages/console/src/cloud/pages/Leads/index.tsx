/* eslint-disable max-lines -- The Leads page keeps the list, the detail card, and the demo request controls together, so the flow reads in one place. */
import { useState } from 'react';
import { Helmet } from 'react-helmet';
import useSWR from 'swr';

import {
  type LandingLead,
  type LandingLeadTranscript,
  useLandingLeads,
} from '@/cloud/hooks/use-landing-leads';
import Button from '@/ds-components/Button';
import Card from '@/ds-components/Card';
import CardTitle from '@/ds-components/CardTitle';
import DangerousRaw from '@/ds-components/DangerousRaw';
import Table from '@/ds-components/Table';
import useApi from '@/hooks/use-api';

import styles from './index.module.scss';

// Leads from the landing demo chat, for the sales team. Read-only: contact details and conversations are
// shown to cloud admins only. Built from the console's own components, like the rest of the console.
// Plain English on purpose, because the page is behind the dev-feature flag.

// The Kubo demo request for a lead, matched by email. Approving it is what starts the tenant's provisioning.
type KuboDemoRequest = { name: string; email: string; phase: string; tenant?: string | undefined };

const formatDate = (value: LandingLead['createdAt']) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const readText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const readList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const readRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};

const readProfile = (lead: LandingLead) => {
  const profile = readRecord(lead.companyProfile);
  const insight = readRecord(profile.conversation);

  return {
    summary: readText(profile.summary),
    sources: readList(profile.sources),
    tone: readText(insight.tone),
    outcomes: readList(insight.outcomes),
    nextSteps: readList(insight.nextSteps),
  };
};

const bookingLinkFor = (base: string, name: string, email: string) =>
  `${base}${base.includes('?') ? '&' : '?'}name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`;

/** Saves a blob the admin has downloaded, through a temporary link. */
const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  // A temporary link is only used to trigger this one download, then discarded.
  // eslint-disable-next-line @silverhand/fp/no-mutation -- The download link is set up before it is clicked.
  link.href = url;
  // eslint-disable-next-line @silverhand/fp/no-mutation -- The download link is set up before it is clicked.
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

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
          className={message.role === 'user' ? styles.messageVisitor : styles.messageAssistant}
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
  const { leads, bookingUrl, error, isLoading, loadTranscript, loadBriefPdf, loadSlidesPptx } =
    useLandingLeads();
  const [openedId, setOpenedId] = useState<string>();
  const [transcript, setTranscript] = useState<LandingLeadTranscript>();
  const [transcriptFailed, setTranscriptFailed] = useState(false);
  const [fileFailed, setFileFailed] = useState(false);
  const api = useApi();
  const demoRequests = useSWR<KuboDemoRequest[]>('api/kubo/demorequests');
  const [demoFailed, setDemoFailed] = useState(false);

  const demoRequestFor = (email: string) =>
    demoRequests.data?.find((request) => request.email.toLowerCase() === email.toLowerCase());

  const decideDemoRequest = async (name: string, decision: 'approve' | 'reject') => {
    setDemoFailed(false);

    try {
      await api.post(`api/kubo/demorequests/${name}/${decision}`);
      await demoRequests.mutate();
    } catch {
      setDemoFailed(true);
    }
  };

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

  const downloadFile = async (
    lead: LandingLead,
    load: (sessionId: string) => Promise<Blob>,
    filename: string
  ) => {
    setFileFailed(false);

    try {
      saveBlob(await load(lead.sessionId), filename);
    } catch {
      setFileFailed(true);
    }
  };

  const opened = leads?.find((lead) => lead.id === openedId);
  const profile = opened ? readProfile(opened) : undefined;

  return (
    <div className={styles.container}>
      <Helmet title="Leads" />

      <Card>
        <CardTitle
          title={<DangerousRaw>Leads</DangerousRaw>}
          subtitle={
            <DangerousRaw>
              Visitors who asked the landing page chat to be contacted. Open a lead to read its
              conversation and download its meeting brief.
            </DangerousRaw>
          }
        />
        <Table
          rowGroups={[{ key: 'leads', data: leads ?? [] }]}
          rowIndexKey="id"
          isLoading={isLoading}
          errorMessage={error ? 'Leads could not be loaded. Try again in a moment.' : undefined}
          placeholder={<DangerousRaw>No leads yet.</DangerousRaw>}
          rowClickHandler={(lead) => {
            void openLead(lead);
          }}
          columns={[
            {
              title: <DangerousRaw>Name</DangerousRaw>,
              dataIndex: 'name',
              render: (lead) => `${lead.lead.firstName} ${lead.lead.lastName}`,
            },
            {
              title: <DangerousRaw>Company</DangerousRaw>,
              dataIndex: 'company',
              render: (lead) => lead.lead.company,
            },
            {
              title: <DangerousRaw>Email</DangerousRaw>,
              dataIndex: 'email',
              render: (lead) => lead.lead.email,
            },
            {
              title: <DangerousRaw>Email sent</DangerousRaw>,
              dataIndex: 'emailStatus',
              render: (lead) => lead.emailStatus,
            },
            {
              title: <DangerousRaw>Created</DangerousRaw>,
              dataIndex: 'createdAt',
              render: (lead) => formatDate(lead.createdAt),
            },
          ]}
        />
      </Card>

      {opened && profile && (
        <Card>
          <CardTitle
            title={<DangerousRaw>Lead details</DangerousRaw>}
            subtitle={
              <DangerousRaw>
                {`${opened.lead.firstName} ${opened.lead.lastName}, ${opened.lead.company}`}
              </DangerousRaw>
            }
          />
          <div className={styles.facts}>
            <span>Email</span>
            <span>{opened.lead.email}</span>
            {opened.lead.role && (
              <>
                <span>Role</span>
                <span>{opened.lead.role}</span>
              </>
            )}
            {opened.lead.industry && (
              <>
                <span>Industry</span>
                <span>{opened.lead.industry}</span>
              </>
            )}
            {opened.lead.contactMethod && (
              <>
                <span>Preferred contact</span>
                <span>
                  {opened.lead.contactMethod}
                  {opened.lead.contactDetail ? `: ${opened.lead.contactDetail}` : ''}
                </span>
              </>
            )}
            {opened.lead.decision && (
              <>
                <span>Wants to see</span>
                <span>{opened.lead.decision}</span>
              </>
            )}
          </div>

          <div className={styles.actions}>
            <Button
              type="primary"
              title={<DangerousRaw>Download meeting brief (PDF)</DangerousRaw>}
              onClick={() => {
                void downloadFile(opened, loadBriefPdf, `meeting-brief-${opened.sessionId}.pdf`);
              }}
            />
            <Button
              type="outline"
              title={<DangerousRaw>Download meeting slides (PPTX)</DangerousRaw>}
              onClick={() => {
                void downloadFile(
                  opened,
                  loadSlidesPptx,
                  `meeting-slides-${opened.sessionId}.pptx`
                );
              }}
            />
            {bookingUrl && (
              <Button
                type="outline"
                title={<DangerousRaw>Book a meeting</DangerousRaw>}
                onClick={() => {
                  window.open(
                    bookingLinkFor(
                      bookingUrl,
                      `${opened.lead.firstName} ${opened.lead.lastName}`,
                      opened.lead.email
                    ),
                    '_blank',
                    'noopener'
                  );
                }}
              />
            )}
          </div>
          {fileFailed && <p className={styles.notice}>The file could not be created.</p>}
          {(() => {
            const request = demoRequestFor(opened.lead.email);

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
                            void decideDemoRequest(request.name, 'approve');
                          }}
                        />
                        <Button
                          type="outline"
                          title={<DangerousRaw>Reject demo</DangerousRaw>}
                          onClick={() => {
                            void decideDemoRequest(request.name, 'reject');
                          }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className={styles.muted}>No demo request for this lead yet.</p>
                )}
                {demoFailed && <p className={styles.notice}>The decision could not be saved.</p>}
              </div>
            );
          })()}

          <div className={styles.section}>
            <p className={styles.heading}>Company</p>
            <p>
              {profile.summary ?? 'No company profile yet. The company website could not be read.'}
            </p>
            {profile.sources.length > 0 && (
              <p className={styles.muted}>Sources: {profile.sources.join(', ')}</p>
            )}
          </div>

          <div className={styles.section}>
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
            <Transcript messages={transcript} isFailed={transcriptFailed} />
          </div>
        </Card>
      )}
    </div>
  );
}

export default Leads;
/* eslint-enable max-lines */
