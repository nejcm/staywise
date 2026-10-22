import { createTransport } from 'nodemailer';
import { serverEnv, appEnv } from './env.server';
import { renderBrandedMail } from './mail-layout';
import { logEvent } from './log.server';

// The single server-only mail path; the SMTP provider must stay the one reviewed for Auth.
const transport = createTransport(serverEnv.smtpUrl);

export type SecurityNotice = 'mfa_enrolled' | 'mfa_unenrolled' | 'agent_grant_created';

const noticeText: Record<SecurityNotice, string> = {
  mfa_enrolled:
    'Multi-factor authentication was enabled on your Staywise host account. If this was not you, sign in and remove it immediately.',
  mfa_unenrolled:
    'Multi-factor authentication was removed from your Staywise host account. If this was not you, contact support immediately.',
  agent_grant_created:
    'A new agent access token was created on your Staywise host account. If this was not you, sign in, revoke it under Settings, and contact support.',
};

// Minimal alert for a new guest message: fixed text, no guest content, no reply address. A failed
// send is logged only — the stored inbox item remains the source of truth.
export async function sendGuestMessageAlert(to: string): Promise<void> {
  try {
    await transport.sendMail({
      from: serverEnv.smtpFrom,
      to,
      subject: 'You have a new guest message',
      ...renderBrandedMail({
        preheader: 'Sign in to read it in your inbox.',
        heading: 'You have a new guest message',
        body: 'A guest sent a message through your Staywise guide. Sign in to read it.',
        action: { label: 'Open inbox', url: `${serverEnv.appOrigin}/host` },
        footnote: 'For privacy, guest messages are never included in email.',
      }),
    });
  } catch {
    logEvent('mail_send_failed', { appEnv, status: 500 });
  }
}

// Best-effort notice with no credentials or guest content; enrollment state is the source of truth.
export async function sendSecurityNotice(to: string, notice: SecurityNotice): Promise<void> {
  try {
    await transport.sendMail({
      from: serverEnv.smtpFrom,
      to,
      subject: 'Staywise security change',
      ...renderBrandedMail({
        preheader: 'A security setting changed on your host account.',
        heading: 'Security change on your account',
        body: noticeText[notice],
        action: { label: 'Review your account', url: `${serverEnv.appOrigin}/host/settings` },
        footnote: 'You are receiving this because your host account security settings changed.',
      }),
    });
  } catch {
    logEvent('mail_send_failed', { appEnv, status: 500 });
  }
}

// Plain text to the help desk inbound address. The host's address goes in Reply-To and the body because the
// SMTP sender is ours; the caller reports a failure to the host, since nothing else keeps the text.
export async function sendSupportRequest(input: {
  hostEmail: string;
  kind: 'issue' | 'help';
  message: string;
}): Promise<boolean> {
  if (!serverEnv.supportEmail) return false;
  try {
    await transport.sendMail({
      from: serverEnv.supportFrom,
      to: serverEnv.supportEmail,
      replyTo: input.hostEmail,
      subject: input.kind === 'issue' ? 'Staywise host: something is broken' : 'Staywise host: needs help',
      text: `From host: ${input.hostEmail}\n\n${input.message}\n`,
    });
    return true;
  } catch {
    logEvent('mail_send_failed', { appEnv, status: 500 });
    return false;
  }
}
