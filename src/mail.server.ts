import nodemailer from 'nodemailer';
import { serverEnv, appEnv } from './env.server';
import { logEvent } from './log.server';

// The single server-only mail path; the SMTP provider must stay the one reviewed for Auth.
const transport = nodemailer.createTransport(serverEnv.smtpUrl);

export type SecurityNotice = 'mfa_enrolled' | 'mfa_unenrolled';

const noticeText: Record<SecurityNotice, string> = {
  mfa_enrolled:
    'Multi-factor authentication was enabled on your Staywise host account. If this was not you, sign in and remove it immediately.',
  mfa_unenrolled:
    'Multi-factor authentication was removed from your Staywise host account. If this was not you, contact support immediately.',
};

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
