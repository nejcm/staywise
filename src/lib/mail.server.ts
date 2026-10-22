import { createTransport } from 'nodemailer';
import { serverEnv, appEnv } from './env.server';
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
      text: 'You have a new guest message in your Staywise inbox. Sign in to read it.',
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
      text: noticeText[notice],
    });
  } catch {
    logEvent('mail_send_failed', { appEnv, status: 500 });
  }
}
