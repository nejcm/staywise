import { describe, expect, it } from 'vitest';
import { addedContact } from './agent-guard';

const zeroWidth = String.fromCodePoint(0x200b);

describe('addedContact', () => {
  it.each([
    ['link', 'Parking behind the house.', 'Pay for parking at https://evil.example/pay.'],
    ['link', 'Parking behind the house.', 'Book at www.evil.example'],
    ['link', 'Parking behind the house.', 'Details on parkhere.si/info'],
    ['link', 'Ask us.', `Visit evil${zeroWidth}.example now`],
    ['email', 'Ask us.', 'Write to refunds@evil.example for a refund.'],
    ['email', 'Ask us.', 'Write to refunds＠evil.example'],
    ['phone', 'Ask us.', 'Call +386 41 234 567 for the key.'],
    ['phone', 'Ask us.', 'Call 041 234 567.'],
    ['payment', 'Pay on arrival.', 'Pay the deposit to SI56 1910 0000 0123 438.'],
    ['link', 'Ask us.', 'Book at evil . example'],
    ['link', 'Ask us.', 'Book at evil(dot)example or evil[.]example'],
    ['link', 'Ask us.', 'Pay at 192.168.1.1/pay'],
    ['link', 'Ask us.', 'Pay at 192.168.1.1.'],
    ['phone', 'Ask us.', 'Call 0412-34-56-78'],
    ['phone', 'Ask us.', 'Call 0412-34-56 78'],
    ['phone', 'Ask us.', 'Call +386 0412-34-56-78'],
    ['phone', 'Ask us.', 'Call 2026-11-01-12'],
    ['email', 'Ask us.', 'Write to refunds (at) evil (dot) example'],
    ['email', 'Ask us.', 'Write to contact @evil.example'],
    ['phone', 'Ask us.', 'Call ٠٤١ ٢٣٤ ٥٦٧.'],
    ['phone', 'Ask us.', 'Call 041x234x567 or 041_234_567.'],
  ])('rejects an added %s', (kind, before, after) => {
    expect(addedContact(before, after)).toBe(kind);
  });

  it.each([
    ['keeps an existing link', 'Bus times at https://bus.example/12.', 'Bus times: https://bus.example/12'],
    ['keeps an existing phone in a new format', 'Call +386 41 234 567.', 'Call +38641234567 if needed.'],
    ['removes contact details', 'Call +386 41 234 567 or mail a@b.example.', 'Ask the host in the app.'],
    ['allows dates, times and prices', 'Check-in.', 'Check-in 2026-11-01 from 15:00, tourist tax 2.50 EUR.'],
    ['allows a sentence-final dot and an at sign before a time', 'Rules.', 'Quiet hours start @ 22:00 . Thanks'],
    ['allows ISO dates with times', 'Stay.', 'Check-in 2026-11-01 15:00, check-out 2026-11-03 10:00.'],
    ['allows a date range', 'Stay.', 'Booked 2026-11-01/2026-11-03.'],
    ['allows abbreviations', 'Rules.', 'No parties, e.g. loud music after 22.00, i.e. quiet hours.'],
  ])('allows text that %s', (_label, before, after) => {
    expect(addedContact(before, after)).toBeNull();
  });
});
