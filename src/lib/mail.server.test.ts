import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }) }));

import { renderBrandedMail } from './mail-layout';
import { sendGuestMessageAlert } from './mail.server';

describe('guest message alert mail', () => {
  beforeEach(() => {
    sendMail.mockReset();
  });

  it('sends the fixed minimal alert with no guest content', async () => {
    sendMail.mockResolvedValue({});
    await sendGuestMessageAlert('host@example.test');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]?.[0];
    expect(mail).toMatchObject({
      from: 'staywise@example.test',
      to: 'host@example.test',
      subject: 'You have a new guest message',
    });
    expect(mail.text).toContain('Sign in to read it.');
    expect(mail.html).toContain('staywise');
    expect(mail.html).toContain('/host"');
  });

  it('escapes markup in rendered mail', () => {
    const { html } = renderBrandedMail({
      preheader: '',
      heading: '<b>x</b>',
      body: '',
      footnote: '',
    });
    expect(html).not.toContain('<b>x</b>');
  });

  it('keeps the guest message alert free of guest content', async () => {
    sendMail.mockResolvedValue({});
    await sendGuestMessageAlert('host@example.test');
    expect(JSON.stringify(sendMail.mock.calls[0]?.[0])).not.toMatch(/reply|property/i);
  });

  it('swallows a transport failure so the stored inbox item stands', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    await expect(sendGuestMessageAlert('host@example.test')).resolves.toBeUndefined();
  });
});
