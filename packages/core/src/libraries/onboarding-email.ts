import { toSingleLine } from './acs-mail.js';

// The onboarding mail of the meshX console, in the same branded HTML the demo-ready mail uses.
// Email clients do not support CSS variables, so the design tokens are inline.

const brand = '#FE330A';
const fg = '#18181b';
const fgMuted = '#71717a';
const fgSubtle = '#a1a1aa';
const bg = '#f4f4f5';
const surface = '#f9fafb';
const card = '#ffffff';
const border = '#e4e4e7';
const footerBg = '#fafafa';
const footerBorder = '#f4f4f5';
const headerBg = '#ffffff';
const headerBorder = '#e4e4e7';

/** The meshX logo, attached to the mail so the client shows it without fetching anything. */
export const meshxLogoBase64 =
  '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';

const logo =
  '<img src="cid:meshx-logo" width="164" height="42" alt="meshX" style="display:block;width:164px;height:42px;border:0;outline:none;text-decoration:none;">';

const step = (n: number, title: string, description: string, padding: string) =>
  '<tr>' +
  `<td style="width:28px;vertical-align:top;padding:${padding};">` +
  `<span style="display:inline-block;width:22px;height:22px;background:${brand};border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:#fff;">${n}</span>` +
  '</td>' +
  `<td style="padding:${padding} 0 0 10px;vertical-align:top;">` +
  `<p style="margin:0;font-size:14px;font-weight:600;color:${fg};">${title}</p>` +
  `<p style="margin:4px 0 0;font-size:13px;color:${fgMuted};line-height:1.5;">${description}</p>` +
  '</td></tr>';

export type OnboardingEmailContent = {
  /** The person who is invited. */
  firstName: string;
  /** Who invited them. */
  inviterName: string;
  /** The sign-in link. */
  link: string;
  /** The role they get in the console. */
  roleName: string;
  /** The day the link stops working, already written out. */
  expiresAt: string;
};

/** The branded HTML body of the onboarding mail. */
export const buildOnboardingEmailHtml = (content: OnboardingEmailContent): string => {
  const name = toSingleLine(content.firstName) || 'there';
  const inviter = toSingleLine(content.inviterName) || 'A meshX administrator';
  const url = toSingleLine(content.link);
  const roleName = toSingleLine(content.roleName) || 'a member';
  const expiresAt = toSingleLine(content.expiresAt);

  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    `<body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">` +
    '<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">' +
    `<table width="520" cellpadding="0" cellspacing="0" style="background:${card};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">` +
    // Header with the logo.
    `<tr><td style="padding:24px 40px;text-align:left;background:${headerBg};border-bottom:1px solid ${headerBorder};">${logo}</td></tr>` +
    // The invitation.
    `<tr><td style="padding:40px 40px 32px;text-align:center;">` +
    `<h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:${fg};">Hi, ${name}. You have been invited to meshX console.</h1>` +
    `<p style="margin:0;font-size:15px;color:${fgMuted};line-height:1.6;max-width:400px;margin-inline:auto;">${inviter} invited you to meshX console as ${roleName}. Use the button below to sign in.</p>` +
    '</td></tr>' +
    // The button and the plain link.
    `<tr><td style="padding:0 40px 32px;text-align:center;">` +
    `<a href="${url}" style="display:inline-block;padding:14px 36px;background:${brand};color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;letter-spacing:.01em;">Open meshX console &rarr;</a>` +
    `<p style="margin:12px 0 0;font-size:11px;color:${fgSubtle};">Or copy this link: <a href="${url}" style="color:${fgMuted};word-break:break-all;">${url}</a></p>` +
    '</td></tr>' +
    // What to do next.
    `<tr><td style="padding:0 40px 32px;">` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="background:${surface};border:1px solid ${border};border-radius:10px;">` +
    `<tr><td style="padding:20px 24px 14px;"><p style="margin:0;font-size:11px;font-weight:700;color:${fg};text-transform:uppercase;letter-spacing:0.06em;">Getting started</p></td></tr>` +
    '<tr><td style="padding:0 24px 20px;"><table width="100%" cellpadding="0" cellspacing="0">' +
    step(1, 'Sign in', 'Use the button above. The link signs you in, so no new password is needed.', '0 0 12px') +
    step(2, 'Set a password', 'Once you are in, set a password in your profile so you can sign in without the link.', '0 0 12px') +
    step(3, `The link works until ${expiresAt}`, 'Need more time? Reply to this email and an administrator can send a new one.', '0 0 0') +
    '</table></td></tr>' +
    '</table>' +
    '</td></tr>' +
    // A way back to a person.
    `<tr><td style="padding:0 40px 32px;text-align:center;">` +
    `<p style="margin:0;font-size:12px;color:${fgSubtle};line-height:1.5;">Questions? Reply to this email or reach us at <a href="mailto:hello@meshx.io" style="color:${fgMuted};text-decoration:underline;">hello@meshx.io</a></p>` +
    '</td></tr>' +
    // Footer.
    `<tr><td style="padding:20px 40px;background:${footerBg};border-top:1px solid ${footerBorder};">` +
    `<p style="margin:0;font-size:11px;color:${fgSubtle};text-align:center;">meshX &middot; <a href="https://meshx.io" style="color:${fgSubtle};text-decoration:underline;">meshx.io</a> &middot; <a href="https://docs.meshx.io" style="color:${fgSubtle};text-decoration:underline;">docs</a></p>` +
    '</td></tr>' +
    '</table></td></tr></table>' +
    '</body></html>'
  );
};

/** The plain-text version of the same mail, for clients that do not render HTML. */
export const buildOnboardingEmailText = (content: OnboardingEmailContent): string => {
  const name = toSingleLine(content.firstName) || 'there';
  const inviter = toSingleLine(content.inviterName) || 'A meshX administrator';
  const roleName = toSingleLine(content.roleName) || 'a member';

  return [
    `Hi, ${name}. You have been invited to meshX console.`,
    '',
    `${inviter} invited you to meshX console as ${roleName}.`,
    '',
    `Open meshX console: ${toSingleLine(content.link)}`,
    '',
    'The link signs you in, so no new password is needed. Once you are in, set a password in your profile.',
    `The link works until ${toSingleLine(content.expiresAt)}.`,
    '',
    'Questions? Reply to this email or reach us at hello@meshx.io',
    '',
    '— meshX',
  ].join('\n');
};
