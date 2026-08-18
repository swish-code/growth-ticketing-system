import nodemailer from 'nodemailer';
import { tabName, type Ticket } from '../shared/spec';
import type { Actor } from './tickets';

/**
 * Email notifications for request lifecycle events.
 *
 * Entirely driven by environment variables and silently disabled until they
 * are set, so the app never depends on a mail server being reachable:
 *
 *   SMTP_HOST     e.g. smtp.gmail.com
 *   SMTP_PORT     default 587 (465 implies TLS)
 *   SMTP_SECURE   'true' to force implicit TLS
 *   SMTP_USER     mailbox username
 *   SMTP_PASS     mailbox password / app password
 *   MAIL_FROM     optional From header, defaults to SMTP_USER
 *   APP_URL       link target in the emails
 *
 * Sending is always fire-and-forget: a mail failure must never fail or slow
 * the API request that triggered it.
 */

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const secure = process.env.SMTP_SECURE === 'true' || port === 465;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const fromAddress =
  process.env.MAIL_FROM ?? (smtpUser ? `Growth Department <${smtpUser}>` : undefined);
const appUrl = (
  process.env.APP_URL ?? 'https://growth-ticketing-system-production.up.railway.app'
).replace(/\/+$/, '');

export const mailEnabled = Boolean(host && smtpUser && smtpPass);

const transporter = mailEnabled
  ? nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: smtpUser as string, pass: smtpPass as string },
    })
  : null;

export function logMailStatus(): void {
  console.log(
    mailEnabled
      ? `Email notifications enabled via ${host}:${port}`
      : 'Email notifications disabled — set SMTP_HOST, SMTP_USER and SMTP_PASS to enable them.',
  );
}

/* ------------------------------------------------------------------ */
/* Event → message                                                     */
/* ------------------------------------------------------------------ */

export type TicketEventKind =
  | 'created'
  | 'accepted'
  | 'declined'
  | 'scheduled'
  | 'done'
  | 'updated'
  | 'deleted';

interface EventCopy {
  subject: string;
  headline: string;
  line: string;
}

function copyFor(kind: TicketEventKind, ticket: Ticket, actor: Actor, detail?: string): EventCopy {
  const id = ticket.id;
  const title = ticket.title;
  const by = actor.email === 'system' ? 'the system' : `${actor.name} (${actor.email})`;

  switch (kind) {
    case 'created':
      return {
        subject: `New request ${id} — ${title}`,
        headline: 'A new request was submitted',
        line: `${id} was submitted by ${by} and is waiting to be accepted.`,
      };
    case 'accepted':
      return {
        subject: `${id} accepted — ${title}`,
        headline: 'Request accepted',
        line: `${id} was accepted by ${by} and is now in progress, assigned to them.`,
      };
    case 'declined':
      return {
        subject: `${id} declined — ${title}`,
        headline: 'Request declined',
        line: `${id} was declined by ${by}.${detail ? ` Reason: ${detail}` : ''}`,
      };
    case 'scheduled':
      return {
        subject: `${id} scheduled — ${title}`,
        headline: 'Request scheduled',
        line: `${id} was scheduled by ${by} and will complete automatically on ${ticket.campaignDate}.`,
      };
    case 'done':
      return {
        subject: `${id} completed — ${title}`,
        headline: 'Request completed',
        line: `${id} was marked as done by ${by}.`,
      };
    case 'deleted':
      return {
        subject: `${id} deleted — ${title}`,
        headline: 'Request deleted',
        line: `${id} was deleted by ${by}.`,
      };
    case 'updated':
    default:
      return {
        subject: `${id} updated — ${title}`,
        headline: 'Request updated',
        line: `${id} was updated by ${by}.${detail ? ` ${detail}` : ''}`,
      };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(copy: EventCopy, ticket: Ticket): string {
  const fact = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 14px 6px 0;color:#7d71a3;font-size:12px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;">${label}</td>
      <td style="padding:6px 0;color:#221540;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
    </tr>`;

  return `
  <div style="margin:0;padding:24px;background:#f4f2fd;font-family:'Segoe UI',system-ui,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e1f5;">
      <div style="padding:18px 24px;background:linear-gradient(120deg,#22d3ee 0%,#a78bfa 55%,#f472b6 100%);">
        <span style="font-size:15px;font-weight:800;color:#150a3d;">Growth Department</span>
        <span style="font-size:12px;color:#2b1a5e;opacity:.8;"> · Campaign Requests</span>
      </div>
      <div style="padding:24px;">
        <h2 style="margin:0 0 6px;font-size:18px;color:#221540;">${escapeHtml(copy.headline)}</h2>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#55487c;">${escapeHtml(copy.line)}</p>
        <table style="border-collapse:collapse;margin-bottom:20px;">
          ${fact('Request', ticket.id)}
          ${fact('Title', ticket.title)}
          ${fact('Tab', tabName(ticket.area))}
          ${fact('Brand', ticket.brand)}
          ${fact('Status', ticket.status)}
        </table>
        <a href="${appUrl}"
           style="display:inline-block;padding:10px 22px;border-radius:999px;background:#6d28d9;color:#ffffff;font-size:13.5px;font-weight:700;text-decoration:none;">
          Open the system
        </a>
      </div>
      <div style="padding:12px 24px;border-top:1px solid #efecf9;font-size:11.5px;color:#9b90bd;">
        You received this because you requested or worked on this request.
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

function recipientsFor(ticket: Ticket, actor: Actor): string[] {
  const all = [ticket.requesterEmail, ticket.ownerEmail, actor.email];
  return [...new Set(all.filter((e): e is string => Boolean(e && e.includes('@'))))];
}

/**
 * Fire-and-forget notification to the requester, the assignee and the acting
 * staff member (deduplicated). Never throws.
 */
export function notifyTicketEvent(
  kind: TicketEventKind,
  ticket: Ticket,
  actor: Actor,
  detail?: string,
): void {
  if (!mailEnabled || !transporter || !fromAddress) return;

  const to = recipientsFor(ticket, actor);
  if (!to.length) return;

  const copy = copyFor(kind, ticket, actor, detail);
  transporter
    .sendMail({
      from: fromAddress,
      to,
      subject: copy.subject,
      text: `${copy.headline}\n\n${copy.line}\n\nRequest: ${ticket.id}\nTitle: ${ticket.title}\nTab: ${tabName(ticket.area)}\nBrand: ${ticket.brand}\nStatus: ${ticket.status}\n\n${appUrl}`,
      html: renderHtml(copy, ticket),
    })
    .then((info) => {
      console.log(`[mail] ${kind} ${ticket.id} → ${to.join(', ')} (${info.messageId})`);
    })
    .catch((error) => {
      console.error(`[mail] failed to send ${kind} for ${ticket.id}:`, error);
    });
}
