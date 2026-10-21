import { describe, expect, it } from 'vitest';
import { guestLocales } from '../guide/guide-validation';
import { guestUiText } from '../guest/guest-ui';
import { utcDay, utcWindow } from '../guest/guest-counters.server';
import {
  MESSAGE_REQUEST_MAX,
  asSectionCategory,
  collectMessageFieldErrors,
  guestMessageFields,
  messageLimits,
  readBoundedBytes,
  readBoundedText,
} from './message-validation';
import { duplicateFingerprint, messageRateFingerprints, readGuideGaps } from './messages.server';

describe('guest message validation', () => {
  const valid = {
    kind: 'question',
    category: 'wifi',
    locale: 'de',
    body: 'Wo ist das WLAN?',
    replyEmail: '',
  };

  it('accepts the compact payload and trims the body', () => {
    const parsed = guestMessageFields.parse({ ...valid, body: '  Wo ist das WLAN?  ' });
    expect(parsed.body).toBe('Wo ist das WLAN?');
    expect(parsed.replyEmail).toBe('');
  });

  it('rejects unknown kinds, categories, locales, unbounded bodies, and bad addresses', () => {
    expect(guestMessageFields.safeParse({ ...valid, kind: 'chat' }).success).toBe(false);
    expect(guestMessageFields.safeParse({ ...valid, category: 'roof' }).success).toBe(false);
    expect(guestMessageFields.safeParse({ ...valid, locale: 'it' }).success).toBe(false);
    expect(guestMessageFields.safeParse({ ...valid, body: '' }).success).toBe(false);
    expect(guestMessageFields.safeParse({ ...valid, body: 'x'.repeat(2001) }).success).toBe(false);
    expect(guestMessageFields.safeParse({ ...valid, body: 'break\u0007' }).success).toBe(false);
    expect(guestMessageFields.safeParse({ ...valid, replyEmail: 'not-an-address' }).success).toBe(false);
    expect(guestMessageFields.safeParse({ ...valid, replyEmail: 'guest@example.test' }).success).toBe(true);
  });

  it('maps field failures to stable guest-facing codes instead of internal messages', () => {
    const result = guestMessageFields.safeParse({
      kind: 'chat',
      category: 'roof',
      locale: 'it',
      body: '',
      replyEmail: 'nope',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(collectMessageFieldErrors(result.error)).toEqual({
      kind: 'kind_invalid',
      category: 'category_invalid',
      locale: 'invalid',
      body: 'message_required',
      replyEmail: 'email_invalid',
    });
  });

  it('falls back to null for categories outside the guide vocabulary', () => {
    expect(asSectionCategory('wifi')).toBe('wifi');
    expect(asSectionCategory('roof')).toBeNull();
    expect(asSectionCategory(null)).toBeNull();
  });

  it('keeps the session limit strictest and the property cap widest', () => {
    expect(messageLimits.sessionPerHour).toBeLessThanOrEqual(messageLimits.linkPerHour);
    expect(messageLimits.linkPerHour).toBeLessThan(messageLimits.propertyPerDay);
  });
});

describe('guest message fingerprints', () => {
  const input = {
    shareId: 'syntheticShareId000001',
    propertyId: '00000000-0000-4000-8000-000000000001',
    sessionToken: 't'.repeat(43),
  };

  it('derives fixed-length per-scope keys that never contain the raw identifiers', () => {
    const first = messageRateFingerprints(input);
    const second = messageRateFingerprints(input);
    for (const key of [first.session, first.link, first.property]) expect(key).toHaveLength(32);
    expect(first.session.equals(second.session)).toBe(true);
    expect(first.session.equals(first.link)).toBe(false);
    expect(first.link.equals(first.property)).toBe(false);
    expect(first.session.toString('latin1')).not.toContain('t'.repeat(43));
    expect(first.link.toString('latin1')).not.toContain(input.shareId);
  });

  it('changes the session key with the token and the duplicate key with every payload field', () => {
    const base = messageRateFingerprints(input);
    const other = messageRateFingerprints({ ...input, sessionToken: 'u'.repeat(43) });
    expect(other.session.equals(base.session)).toBe(false);
    const submission = {
      sessionToken: input.sessionToken,
      kind: 'issue' as const,
      category: 'wifi' as const,
      locale: 'en',
      body: 'Kaputt',
      replyEmail: null,
    };
    const duplicate = duplicateFingerprint(submission);
    expect(duplicate.equals(duplicateFingerprint({ ...submission }))).toBe(true);
    // Only an exact retry of the full canonical payload is the same submission.
    expect(duplicate.equals(duplicateFingerprint({ ...submission, body: 'Kaputt!' }))).toBe(false);
    expect(duplicate.equals(duplicateFingerprint({ ...submission, kind: 'question' }))).toBe(false);
    expect(duplicate.equals(duplicateFingerprint({ ...submission, category: 'parking' }))).toBe(false);
    expect(duplicate.equals(duplicateFingerprint({ ...submission, locale: 'de' }))).toBe(false);
    expect(duplicate.equals(duplicateFingerprint({ ...submission, replyEmail: 'guest@example.test' }))).toBe(false);
    expect(
      duplicateFingerprint({ ...submission, replyEmail: 'guest@example.test' }).equals(
        duplicateFingerprint({ ...submission, replyEmail: 'other@example.test' }),
      ),
    ).toBe(false);
    expect(duplicate.toString('latin1')).not.toContain('Kaputt');
    expect(duplicateFingerprint({ ...submission, replyEmail: 'guest@example.test' }).toString('latin1')).not.toContain(
      'guest@example.test',
    );
  });
});

describe('guest message byte bound', () => {
  function instrumented(chunks: Uint8Array[]) {
    let pulls = 0;
    let delivered = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulls >= chunks.length) {
            controller.close();
            return;
          }
          const chunk = chunks[pulls] ?? new Uint8Array();
          pulls += 1;
          delivered += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      // Zero backpressure slack keeps the pull count equal to the reads the reader asked for.
      { highWaterMark: 0 },
    );
    return { stream, state: () => ({ pulls, delivered, cancelled }) };
  }

  it('stops reading and cancels the stream once the byte bound is exceeded', async () => {
    const chunk = new Uint8Array(4096).fill(0x78);
    const source = instrumented(Array.from({ length: 50 }, () => chunk));
    expect(await readBoundedText(source.stream, MESSAGE_REQUEST_MAX)).toEqual({ state: 'denied' });
    const state = source.state();
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBe(3);
    expect(state.delivered).toBe(MESSAGE_REQUEST_MAX + chunk.byteLength);
  });

  it('bounds bytes rather than characters for multi-byte payloads', async () => {
    const payload = new TextEncoder().encode(JSON.stringify({ body: '界'.repeat(4000) }));
    expect(payload.byteLength).toBeGreaterThan(MESSAGE_REQUEST_MAX);
    expect(payload.byteLength).toBeLessThan(MESSAGE_REQUEST_MAX * 2);
    const source = instrumented([payload]);
    expect(await readBoundedText(source.stream, MESSAGE_REQUEST_MAX)).toEqual({ state: 'denied' });
    expect(source.state().cancelled).toBe(true);
  });

  it('accepts a body of exactly the bound', async () => {
    const source = instrumented([new Uint8Array(MESSAGE_REQUEST_MAX).fill(0x78)]);
    expect(await readBoundedText(source.stream, MESSAGE_REQUEST_MAX)).toEqual({
      state: 'ok',
      text: 'x'.repeat(MESSAGE_REQUEST_MAX),
    });
    expect(source.state().cancelled).toBe(false);
  });

  it('decodes an accepted payload across chunk boundaries, including split characters', async () => {
    const encoder = new TextEncoder();
    const head = encoder.encode('Gdje je Wi-Fi? ');
    const tail = encoder.encode('你好 ünë — OK');
    // Split inside the 3-byte 你 so streaming decode has to hold a partial character.
    const source = instrumented([head, tail.slice(0, 1), tail.slice(1)]);
    expect(await readBoundedText(source.stream, MESSAGE_REQUEST_MAX)).toEqual({
      state: 'ok',
      text: 'Gdje je Wi-Fi? 你好 ünë — OK',
    });
    expect(source.state().cancelled).toBe(false);
  });

  it('returns the raw bytes joined across chunks, and denies one byte more', async () => {
    const accepted = instrumented([Uint8Array.from([0xff, 0xd8]), Uint8Array.from([0x00, 0xff, 0xd9])]);
    expect(await readBoundedBytes(accepted.stream, 5)).toEqual({
      state: 'ok',
      bytes: Uint8Array.from([0xff, 0xd8, 0x00, 0xff, 0xd9]),
    });
    const over = instrumented([new Uint8Array(3), new Uint8Array(3)]);
    expect(await readBoundedBytes(over.stream, 5)).toEqual({ state: 'denied' });
    expect(over.state().cancelled).toBe(true);
  });

  it('treats an absent body as empty and a failing stream as denied', async () => {
    expect(await readBoundedText(null, MESSAGE_REQUEST_MAX)).toEqual({ state: 'ok', text: '' });
    const failing = new ReadableStream<Uint8Array>(
      {
        pull() {
          throw new Error('synthetic read failure');
        },
      },
      { highWaterMark: 0 },
    );
    expect(await readBoundedText(failing, MESSAGE_REQUEST_MAX)).toEqual({ state: 'denied' });
  });
});

describe('guest counter windows', () => {
  it('buckets fixed UTC windows and derives the aggregate day', () => {
    const midday = Date.UTC(2026, 9, 19, 12, 34, 56);
    expect(utcWindow(3600, midday).toISOString()).toBe('2026-10-19T12:00:00.000Z');
    expect(utcDay(utcWindow(86_400, midday))).toBe('2026-10-19');
    expect(utcDay(utcWindow(86_400, Date.UTC(2026, 9, 19, 23, 59, 59)))).toBe('2026-10-19');
    expect(utcDay(utcWindow(86_400, Date.UTC(2026, 9, 20, 0, 0, 1)))).toBe('2026-10-20');
  });
});

describe('guest message copy', () => {
  it('never promises an immediate reply in any approved locale', () => {
    const promises = /immediately|as soon as|right away|sofort|takoj/i;
    for (const locale of guestLocales) {
      expect(guestUiText(locale, 'form.sent')).not.toMatch(promises);
      expect(guestUiText(locale, 'help.form.intro')).not.toMatch(promises);
      expect(guestUiText(locale, 'help.form.privacy')).toMatch(/c[oó]d|kod/i);
    }
  });
});

describe('guide gaps', () => {
  it('maps counts only, keeps a null category, and filters questions tagged not in the guide', async () => {
    let query = '';
    const tx = ((strings: TemplateStringsArray) => {
      query = strings.join('?');
      return Promise.resolve([
        { category: 'parking', asked: 3, last_asked: new Date('2026-10-20T10:00:00Z') },
        { category: null, asked: 1, last_asked: new Date('2026-10-19T10:00:00Z') },
      ]);
    }) as never;
    expect(await readGuideGaps(tx, 'p1')).toEqual([
      { category: 'parking', asked: 3, lastAsked: '2026-10-20T10:00:00.000Z' },
      { category: null, asked: 1, lastAsked: '2026-10-19T10:00:00.000Z' },
    ]);
    expect(query).toContain("m.kind = 'question' and m.answer_in_guide = false");
    expect(query).toContain('s.category = m.category');
    expect(query).not.toMatch(/\bbody\b/);
  });
});
