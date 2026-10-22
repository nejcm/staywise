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
    ['phone', 'Ask us.', 'Call/pay +386\u201340\u2013123\u2013456 now.'],
    ['phone', 'Ask us.', 'Call +386\u201040\u2010123\u2010456 now.'],
    ['phone', 'Ask us.', 'Call +386\u201140\u2011123\u2011456 now.'],
    ['phone', 'Ask us.', 'Call +386\u201440\u2014123\u2014456 now.'],
    ['phone', 'Ask us.', 'Call +386\u221240\u2212123\u2212456 now.'],
    ['phone', 'Ask us.', 'Call +386\u00b740\u00b7123\u00b7456 now.'],
    ['phone', 'Ask us.', 'Call +386,40,123,456 now.'],
    ['phone', 'Ask us.', 'Call 041,23,45,67 now.'],
    ['payment', 'Pay on arrival.', 'Pay the deposit to SI56\u20131910\u20130000\u20130123\u2013438.'],
    ['payment', 'Pay on arrival.', 'Pay the deposit to SI56-1910-0000-0123-438.'],
    ['link', 'Ask us.', 'Pay at evil-pay\u3002com'],
    ['link', 'Ask us.', 'Pay at evil-pay\uff61com'],
    ['phone', 'Ask us.', 'Call +386 \u201340\u2013123 456 now.'],
    ['phone', 'Ask us.', 'Call 041.234.567 now.'],
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
    ['allows comma-grouped prices', 'Prices.', 'Prices: 1,500, 2,300, 4,100 EUR per week.'],
    ['allows a thousands-grouped amount', 'Prices.', 'Deposit cover up to 1,250,000 EUR.'],
    ['allows en-dash ranges', 'Rules.', 'Breakfast 7\u201310, quiet hours 22\u20137, rooms 10\u201312.'],
    ['allows en-dash dates', 'Stay.', 'Open 2026\u201311\u201301 to 2026\u201311\u201303.'],
    ['allows an en-dash date range', 'Stay.', 'Booked 2026-11-01\u20132026-11-03.'],
    ['allows an en-dash time range', 'Rules.', 'Reception 08:00\u201320:00, check-out 10:00.'],
    ['allows a spaced en-dash range of dotted dates', 'Stay.', 'Booked 10.11.2026 \u2013 15.11.2026.'],
    ['allows dotted day ranges', 'Stay.', 'Open 10.\u201312. 11. 2026 and 24.\u201326. 12. 2026.'],
    ['allows dotted prices with spaced en dashes', 'Prices.', 'Rates 1.200 \u2013 1.500 \u2013 1.800 EUR per week.'],
    ['allows a dotted date range', 'Stay.', 'Booked 10.11.\u201315.11.2026.'],
  ])('allows text that %s', (_label, before, after) => {
    expect(addedContact(before, after)).toBeNull();
  });
});
