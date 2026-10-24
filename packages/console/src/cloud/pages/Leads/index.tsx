/* eslint-disable max-lines -- Page-local action orchestration keeps selection, drafts and request lifetimes together. */
import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import useSWR, { useSWRConfig } from 'swr';

import {
  type LandingLead,
  type LandingLeadAssist,
  type LandingLeadTranscript,
  useLandingLeads,
  useLandingLeadStats,
} from '@/cloud/hooks/use-landing-leads';
import useManageLandingPageGuard from '@/cloud/hooks/use-manage-landing-page-guard';
import StatTile from '@/ds-components/StatTile';
import useApi from '@/hooks/use-api';

import LeadDetails, {
  type KuboDemoRequest,
  type LeadProfile,
  readProfile,
} from './components/LeadDetails';
import LeadsList from './components/LeadsList';
import LeadsTrend from './components/LeadsTrend';
import PipelineRail from './components/PipelineRail';
import styles from './index.module.scss';
import { toChartPoints, toKpiTiles, toPipelineRows } from './lead-stats';

const bookingLinkFor = (base: string, name: string, email: string) =>
  `${base}${base.includes('?') ? '&' : '?'}name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`;

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Configure the temporary download link before activation.
  link.href = url;
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Configure the temporary download link before activation.
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

type Draft = { notes: string; tags: string };
type LeadFields = { status?: string; notes?: string; tags?: string[] };

const focusLeadHeading = (heading: HTMLHeadingElement | undefined) => {
  heading?.focus();
};

function Leads() {
  const ensureLandingPageScope = useManageLandingPageGuard();
  const [scopeReady, setScopeReady] = useState<boolean>();

  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      try {
        const allowed = await ensureLandingPageScope();
        if (!controller.signal.aborted) {
          setScopeReady(allowed);
        }
      } catch {
        if (!controller.signal.aborted) {
          setScopeReady(false);
        }
      }
    };
    void check();
    return () => {
      controller.abort();
    };
  }, [ensureLandingPageScope]);

  if (scopeReady === undefined) {
    return <p role="status">Checking landing page permission…</p>;
  }
  if (!scopeReady) {
    return (
      <div style={{ padding: 24 }}>You do not have permission to view landing page leads.</div>
    );
  }
  return <LeadsContent />;
}

function LeadsContent() {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [page, setPage] = useState(1);
  const {
    leads,
    totalCount,
    bookingUrl,
    key,
    error,
    isLoading,
    hasFreshResponse,
    loadTranscript,
    loadBriefPdf,
    loadSlidesPptx,
    updateLead,
    loadAssist,
  } = useLandingLeads({
    page,
    pageSize: 20,
    search,
    stage: stageFilter,
    tagSearch: tagFilter,
  });
  const stats = useLandingLeadStats();
  const { mutate } = useSWRConfig();
  const currentListKey = useRef(key);
  useEffect(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Pending saves must also refresh the latest committed list query.
    currentListKey.current = key;
  }, [key]);
  useEffect(() => {
    // The hook's fallback count is zero while a new page is loading or has failed.
    if (!hasFreshResponse || isLoading || Boolean(error) || !leads) {
      return;
    }
    const lastPage = Math.max(1, Math.ceil(totalCount / 20));
    if (page > lastPage) {
      setPage(lastPage);
    }
  }, [error, hasFreshResponse, isLoading, leads, page, totalCount]);
  const [opened, setOpened] = useState<LandingLead>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const savedCopies = useRef(new Map<string, LandingLead>());
  // A visit token also distinguishes A -> B -> A, not just different IDs.
  const visit = useRef(0);
  const pending = useRef(new Set<string>());
  const [savingLeadIds, setSavingLeadIds] = useState<ReadonlySet<string>>(new Set());
  const heading = useRef<HTMLHeadingElement>(null);
  const [transcript, setTranscript] = useState<LandingLeadTranscript>();
  const [transcriptFailed, setTranscriptFailed] = useState(false);
  const [fileFailed, setFileFailed] = useState(false);
  const [demoFailed, setDemoFailed] = useState(false);
  const [assist, setAssist] = useState<LandingLeadAssist>();
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistFailed, setAssistFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const api = useApi();
  const demoRequests = useSWR<KuboDemoRequest[]>('api/kubo/demorequests');

  useEffect(
    () => () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Invalidate every pending visit when the page unmounts.
      visit.current += 1;
    },
    []
  );
  useEffect(() => {
    focusLeadHeading(heading.current ?? undefined);
  }, [opened?.id]);

  const decideDemoRequest = async (name: string, decision: 'approve' | 'reject') => {
    const action = `demo:${name}`;
    if (pending.current.has(action)) {
      return;
    }
    pending.current.add(action);
    const token = visit.current;
    setDemoFailed(false);
    try {
      await api.post(`api/kubo/demorequests/${name}/${decision}`);
      await demoRequests.mutate();
    } catch {
      if (visit.current === token) {
        setDemoFailed(true);
      }
    } finally {
      pending.current.delete(action);
    }
  };

  const saveLead = async (lead: LandingLead, fields: LeadFields) => {
    const action = `save:${lead.id}`;
    if (pending.current.has(action)) {
      return;
    }
    pending.current.add(action);
    setSavingLeadIds((ids) => new Set([...ids, lead.id]));
    const token = visit.current;
    setSaveFailed(false);
    try {
      await updateLead(lead.id, fields);
      const updated = { ...(savedCopies.current.get(lead.id) ?? lead), ...fields };
      savedCopies.current.set(lead.id, updated);
      // Do not replace another lead, or a draft edited while the request was pending.
      setOpened((current) => (current?.id === lead.id ? updated : current));
      await Promise.all(
        [...new Set([key, currentListKey.current, '/api/landing-leads/stats'])].map(
          async (requestKey) => mutate(requestKey)
        )
      );
    } catch {
      if (visit.current === token) {
        setSaveFailed(true);
      }
    } finally {
      pending.current.delete(action);
      setSavingLeadIds((ids) => new Set([...ids].filter((id) => id !== lead.id)));
    }
  };

  const runLeadAssist = async (lead: LandingLead) => {
    const action = `assist:${lead.id}`;
    if (pending.current.has(action)) {
      return;
    }
    pending.current.add(action);
    const token = visit.current;
    setAssistLoading(true);
    setAssistFailed(false);
    setAssist(undefined);
    try {
      const result = await loadAssist(lead.sessionId);
      if (visit.current === token) {
        setAssist(result);
      }
    } catch {
      if (visit.current === token) {
        setAssistFailed(true);
      }
    } finally {
      pending.current.delete(action);
      if (visit.current === token) {
        setAssistLoading(false);
      }
    }
  };

  const openLead = async (lead: LandingLead) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Each selection invalidates the previous visit, including A -> B -> A.
    visit.current += 1;
    const token = visit.current;
    if (opened?.id === lead.id) {
      focusLeadHeading(heading.current ?? undefined);
    }
    setOpened(savedCopies.current.get(lead.id) ?? lead);
    setTranscript(undefined);
    setAssist(undefined);
    setAssistLoading(false);
    setAssistFailed(false);
    setSaveFailed(false);
    setFileFailed(false);
    setDemoFailed(false);
    setTranscriptFailed(false);
    try {
      const result = await loadTranscript(lead.sessionId);
      if (visit.current === token) {
        setTranscript(result);
      }
    } catch {
      if (visit.current === token) {
        setTranscriptFailed(true);
      }
    }
  };

  const downloadFile = async (
    lead: LandingLead,
    load: (sessionId: string) => Promise<Blob>,
    filename: string
  ) => {
    const action = `file:${lead.id}:${filename}`;
    if (pending.current.has(action)) {
      return;
    }
    pending.current.add(action);
    const token = visit.current;
    setFileFailed(false);
    try {
      const blob = await load(lead.sessionId);
      if (visit.current === token) {
        saveBlob(blob, filename);
      }
    } catch {
      if (visit.current === token) {
        setFileFailed(true);
      }
    } finally {
      pending.current.delete(action);
    }
  };

  const draft = opened
    ? (drafts[opened.id] ?? { notes: opened.notes ?? '', tags: (opened.tags ?? []).join(', ') })
    : { notes: '', tags: '' };
  const profile: LeadProfile | undefined = opened ? readProfile(opened) : undefined;
  const editDraft = (fields: Partial<Draft>) => {
    if (opened) {
      setDrafts((current) => ({ ...current, [opened.id]: { ...draft, ...fields } }));
    }
  };
  const openedDemoRequest = opened
    ? demoRequests.data?.find(
        (request) => request.email.toLowerCase() === opened.lead.email.toLowerCase()
      )
    : undefined;
  const summary = stats.data && !stats.isLoading ? stats.data : undefined;
  const points = summary ? toChartPoints(summary) : [];

  return (
    <div className={styles.container}>
      <Helmet title="Leads" />
      {stats.isLoading && (
        <p role="status" className={styles.muted}>
          Loading lead statistics…
        </p>
      )}
      {stats.error && (
        <p role="alert" className={styles.notice}>
          Lead statistics could not be loaded.
        </p>
      )}
      {summary && (
        <div className={styles.tiles}>
          {toKpiTiles(summary).map((tile) => (
            <StatTile
              key={tile.key}
              title={tile.label}
              count={tile.value}
              delta={tile.delta}
              appearance="eyebrow"
            />
          ))}
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.main}>
          {summary && (
            <LeadsTrend
              points={points}
              summaryLabel={`New leads per week over the last ${points.length} weeks.`}
            />
          )}
          {summary && <PipelineRail rows={toPipelineRows(summary)} />}
          <LeadsList
            leads={leads ?? []}
            totalCount={totalCount}
            page={page}
            search={search}
            stage={stageFilter}
            tag={tagFilter}
            isLoading={isLoading}
            isFailed={Boolean(error)}
            selectedLeadId={opened?.id}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            onStageChange={(value) => {
              setStageFilter(value);
              setPage(1);
            }}
            onTagChange={(value) => {
              setTagFilter(value);
              setPage(1);
            }}
            onPageChange={setPage}
            onSelectLead={(lead) => {
              void openLead(lead);
            }}
          />
        </div>
        <aside className={styles.rail} aria-label="Lead workspace">
          {opened && profile ? (
            <section className={styles.detailPane} aria-label="Selected lead details">
              <h2 ref={heading} tabIndex={-1} className={styles.detailHeading}>
                {opened.lead.firstName} {opened.lead.lastName}
              </h2>
              <LeadDetails
                lead={opened}
                profile={profile}
                transcript={transcript}
                hasTranscriptFailed={transcriptFailed}
                assist={assist}
                isAssistLoading={assistLoading}
                demoRequest={openedDemoRequest}
                hasDemoFailed={demoFailed}
                notes={draft.notes}
                tags={draft.tags}
                hasSaveFailed={saveFailed}
                isSaving={savingLeadIds.has(opened.id)}
                hasFileFailed={fileFailed}
                hasAssistFailed={assistFailed}
                onNotesChange={(notes) => {
                  editDraft({ notes });
                }}
                onTagsChange={(tags) => {
                  editDraft({ tags });
                }}
                onSave={() => {
                  void saveLead(opened, {
                    notes: draft.notes,
                    tags: [
                      ...new Set(
                        draft.tags
                          .split(',')
                          .map((tag) => tag.trim())
                          .filter(Boolean)
                      ),
                    ],
                  });
                }}
                onStageChange={(status) => {
                  void saveLead(opened, { status });
                }}
                onRunAssist={() => {
                  void runLeadAssist(opened);
                }}
                onDecideDemo={(decision) => {
                  if (openedDemoRequest) {
                    void decideDemoRequest(openedDemoRequest.name, decision);
                  }
                }}
                onDownloadBrief={() => {
                  void downloadFile(opened, loadBriefPdf, `meeting-brief-${opened.sessionId}.pdf`);
                }}
                onDownloadSlides={() => {
                  void downloadFile(
                    opened,
                    loadSlidesPptx,
                    `meeting-slides-${opened.sessionId}.pptx`
                  );
                }}
                onBookMeeting={
                  bookingUrl
                    ? () => {
                        window.open(
                          bookingLinkFor(
                            bookingUrl,
                            `${opened.lead.firstName} ${opened.lead.lastName}`,
                            opened.lead.email
                          ),
                          '_blank',
                          'noopener'
                        );
                      }
                    : undefined
                }
              />
            </section>
          ) : (
            <p className={styles.muted}>Select a lead to see its details.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

export default Leads;
/* eslint-enable max-lines */
