import type { LandingLead } from '@/cloud/hooks/use-landing-leads';
import Button from '@/ds-components/Button';
import Card from '@/ds-components/Card';
import CardTitle from '@/ds-components/CardTitle';
import DangerousRaw from '@/ds-components/DangerousRaw';
import Pagination from '@/ds-components/Pagination';
import TextInput from '@/ds-components/TextInput';

import { leadStages, stageLabel } from '../stages';

import styles from './LeadsList.module.scss';

type Props = {
  readonly leads: readonly LandingLead[];
  readonly totalCount: number;
  readonly page: number;
  readonly search: string;
  readonly stage: string;
  readonly tag: string;
  readonly selectedLeadId?: string;
  readonly isLoading: boolean;
  readonly isFailed: boolean;
  readonly onSearchChange: (value: string) => void;
  readonly onStageChange: (value: string) => void;
  readonly onTagChange: (value: string) => void;
  readonly onPageChange: (page: number) => void;
  readonly onSelectLead: (lead: LandingLead) => void;
};

const formatDate = (value: LandingLead['createdAt']) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function LeadQueue({
  leads,
  isLoading,
  isFailed,
  selectedLeadId,
  onSelectLead,
  hasFilters,
}: Pick<Props, 'leads' | 'isLoading' | 'isFailed' | 'selectedLeadId' | 'onSelectLead'> & {
  readonly hasFilters: boolean;
}) {
  if (isLoading) {
    return (
      <p role="status" className={styles.muted}>
        Loading leads…
      </p>
    );
  }
  if (isFailed && leads.length === 0) {
    return (
      <p role="alert" className={styles.notice}>
        Leads could not be loaded. Try again in a moment.
      </p>
    );
  }
  if (leads.length === 0) {
    return (
      <p role="status" className={styles.muted}>
        {hasFilters ? 'No leads match your filters.' : 'No leads yet.'}
      </p>
    );
  }
  return (
    <ul className={styles.queue}>
      {leads.map((lead) => (
        <li key={lead.id}>
          <Button
            type="text"
            className={styles.queueRow}
            aria-pressed={selectedLeadId === lead.id}
            title={
              <DangerousRaw>
                <span className={styles.rowHeading}>
                  <strong>
                    {lead.lead.firstName} {lead.lead.lastName}
                  </strong>
                  <span className={styles.stage}>{lead.status.replace('_', ' ')}</span>
                </span>
                <span className={styles.rowContext}>{lead.lead.company}</span>
                <span className={styles.rowContext}>{lead.lead.email}</span>
                {lead.tags && lead.tags.length > 0 && (
                  <span className={styles.rowContext}>Tags: {lead.tags.join(', ')}</span>
                )}
                <span className={styles.rowMeta}>
                  Created {formatDate(lead.createdAt)} · Email: {lead.emailStatus}
                </span>
                {selectedLeadId === lead.id && (
                  <span className={styles.selectedLabel}>Selected</span>
                )}
              </DangerousRaw>
            }
            onClick={() => {
              onSelectLead(lead);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

export default function LeadsList({
  leads,
  totalCount,
  page,
  search,
  stage,
  tag,
  selectedLeadId,
  isLoading,
  isFailed,
  onSearchChange,
  onStageChange,
  onTagChange,
  onPageChange,
  onSelectLead,
}: Props) {
  return (
    <Card className={styles.queueCard}>
      <section aria-label="Sales queue">
        <CardTitle
          title={<DangerousRaw>Sales queue</DangerousRaw>}
          subtitle={
            <DangerousRaw>
              Visitors who asked the landing page chat to be contacted. Self-hosted leads/CRM
              integrated in the Verity API. Open a lead to read its conversation and download its
              meeting brief.
            </DangerousRaw>
          }
        />
        <div className={styles.filters}>
          <TextInput
            aria-label="Search leads"
            placeholder="Search leads..."
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
          />
          <select
            aria-label="Filter by pipeline status"
            value={stage}
            onChange={(event) => {
              onStageChange(event.target.value);
            }}
          >
            <option value="">All stages</option>
            {leadStages.map((value) => (
              <option key={value} value={value}>
                {stageLabel(value)}
              </option>
            ))}
          </select>
          <TextInput
            aria-label="Filter by tag"
            placeholder="Filter by tag..."
            value={tag}
            onChange={(event) => {
              onTagChange(event.target.value);
            }}
          />
        </div>
        {!isLoading && <p className={styles.muted}>{totalCount} matching</p>}
        <LeadQueue
          leads={leads}
          isLoading={isLoading}
          isFailed={isFailed}
          selectedLeadId={selectedLeadId}
          hasFilters={Boolean(search || stage || tag)}
          onSelectLead={onSelectLead}
        />
        <Pagination
          page={page}
          pageSize={20}
          totalCount={isLoading ? undefined : totalCount}
          onChange={onPageChange}
        />
      </section>
    </Card>
  );
}
