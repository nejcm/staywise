import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { sendGuestMessageAlert } from './mail.server';

describe('guest message alert mail', () => {
  beforeEach(() => {
    sendMail.mockReset();
  });

  it('sends the fixed minimal alert with no guest content', async () => {
    sendMail.mockResolvedValue({});
    await sendGuestMessageAlert('host@example.test');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0]).toEqual({
      from: 'staywise@example.test',
      to: 'host@example.test',
      subject: 'You have a new guest message',
      text: 'You have a new guest message in your Staywise inbox. Sign in to read it.',
    });
  });

  it('swallows a transport failure so the stored inbox item stands', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    await expect(sendGuestMessageAlert('host@example.test')).resolves.toBeUndefined();
  });
});
