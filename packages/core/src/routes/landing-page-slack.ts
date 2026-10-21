// Posts a new landing lead to a Slack channel through its incoming webhook. The webhook is bound to one
// channel, so no bot token is needed. Nothing is posted unless `LANDING_LEAD_SLACK_WEBHOOK_URL` is set.
// The message is a Block Kit template: header, lead fields, company and conversation, and a link to the
// Leads page. A failed post is logged without any lead details and never affects the visitor.

export type SlackLeadInput = {
  lead: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    role?: string;
    industry?: string;
    decision?: string;
    contactMethod?: string;
    contactDetail?: string;
  };
  emailStatus: string;
  leadsUrl?: string;
  /** Signed download links for the meeting brief (PDF) and the slides (PPTX). */
  fileLinks?: { brief?: string; slides?: string };
  profile?: {
    summary?: string;
    conversation?: { tone?: string; outcomes?: string[]; nextSteps?: string[] };
  };
};

type Block = Record<string, unknown>;

const clip = (value: string): string => value.slice(0, 2900);

const bullets = (items: string[] | undefined) =>
  items && items.length > 0 ? items.map((item) => `• ${item}`).join('\n') : '_not analysed yet_';

const slackButton = (label: string, url: string): Block => ({
  type: 'button',
  text: { type: 'plain_text', text: label, emoji: false },
  url,
});

const contactLine = (lead: SlackLeadInput['lead']): string => {
  if (lead.contactDetail) {
    return `${lead.contactMethod ?? 'contact'}: ${lead.contactDetail}`;
  }

  return lead.contactMethod ?? 'email';
};

/** The Slack Block Kit message for a lead. */
const buildLeadSlackMessage = (input: SlackLeadInput): { text: string; blocks: Block[] } => {
  const { lead, profile } = input;
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  const contact = contactLine(lead);
  const conversation = profile?.conversation;

  const blocks: Block[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: clip(`New lead: ${lead.company}`), emoji: false },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: clip(`*Name*\n${name}${lead.role ? `, ${lead.role}` : ''}`) },
        { type: 'mrkdwn', text: clip(`*Email*\n${lead.email}`) },
        { type: 'mrkdwn', text: clip(`*Industry*\n${lead.industry ?? '—'}`) },
        { type: 'mrkdwn', text: clip(`*Prefers*\n${contact}`) },
        { type: 'mrkdwn', text: clip(`*Wants to see*\n${lead.decision ?? '—'}`) },
        { type: 'mrkdwn', text: clip(`*Email sent*\n${input.emailStatus}`) },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: clip(`*Company*\n${profile?.summary ?? '_No company profile yet._'}`),
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: clip(
          `*Tone:* ${conversation?.tone ?? '_not analysed yet_'}\n*Likely outcomes*\n${bullets(conversation?.outcomes)}\n*Cover next*\n${bullets(conversation?.nextSteps)}`
        ),
      },
    },
  ];

  const buttons = [
    input.leadsUrl && slackButton('Open in Leads', input.leadsUrl),
    input.fileLinks?.brief && slackButton('Meeting brief (PDF)', input.fileLinks.brief),
    input.fileLinks?.slides && slackButton('Meeting slides (PPTX)', input.fileLinks.slides),
  ].filter(Boolean);
  const actions: Block[] = buttons.length > 0 ? [{ type: 'actions', elements: buttons }] : [];

  return { text: `New lead: ${lead.company}`, blocks: [...blocks, ...actions] };
};

type PostFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number }>;

/** Posts the message to the webhook. Returns false when no webhook is configured. Throws when Slack refuses it. */
export const postLeadToSlack = async (
  input: SlackLeadInput,
  options: { webhookUrl?: string; fetch: PostFetch }
): Promise<boolean> => {
  if (!options.webhookUrl) {
    return false;
  }

  const response = await options.fetch(options.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildLeadSlackMessage(input)),
  });

  if (!response.ok) {
    throw new Error(`Slack refused the lead message with status ${response.status}`);
  }

  return true;
};
