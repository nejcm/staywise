import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuestMessageForm, SentRecap, messageExcerpt, summaryEntries } from './guest-message-form';

describe('guest message form', () => {
  it('links summary entries to field ids in form order and skips fieldless errors', () => {
    expect(
      summaryEntries({
        replyEmail: 'email_invalid',
        kind: 'kind_invalid',
        body: 'message_required',
      }),
    ).toEqual([
      { field: 'body', id: 'guest-message-body', code: 'message_required' },
      { field: 'replyEmail', id: 'guest-message-email', code: 'email_invalid' },
    ]);
    expect(summaryEntries({ locale: 'locale_invalid' })).toEqual([]);
  });

  it('trims the excerpt to about 120 characters', () => {
    expect(messageExcerpt('  short  ')).toBe('short');
    const excerpt = messageExcerpt('a'.repeat(200));
    expect(excerpt).toBe(`${'a'.repeat(120)}…`);
  });

  it('renders the recap from the snapshot without the reply address', () => {
    const html = renderToString(
      <SentRecap
        snapshot={{
          kind: 'issue',
          category: 'wifi',
          body: 'Router is off',
          replyEmail: 'guest@example.test',
        }}
        locale="en"
        onAgain={() => {}}
      />,
    );
    expect(html).toContain('Something is wrong');
    expect(html).toContain('Wi-Fi');
    expect(html).toContain('Router is off');
    expect(html).toContain('Yes');
    expect(html).not.toContain('guest@example.test');
    expect(html).toContain('data-testid="guest-message-again"');
    expect(
      renderToString(
        <SentRecap
          snapshot={{
            kind: 'question',
            category: 'wifi',
            body: 'x',
            replyEmail: '',
          }}
          locale="en"
          onAgain={() => {}}
        />,
      ),
    ).toContain('>No<');
  });

  it('renders an idle form with enabled fields and no summary', () => {
    const html = renderToString(<GuestMessageForm shareId="synthetic" locale="en" />);
    expect(html).not.toContain('guest-message-summary');
    expect(html).toMatch(/<fieldset class="[^"]*"><fieldset>/);
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('Send message');
  });
});

describe('Call after sending', () => {
  const snapshot = { kind: 'question' as const, category: 'wifi' as const, body: 'Hi', replyEmail: '' };
  it('offers Call on the sent state only when the host has a phone', () => {
    const withPhone = renderToString(
      <SentRecap snapshot={snapshot} locale="en" onAgain={() => {}} phone="+38641234567" />,
    );
    expect(withPhone).toContain('If it gets urgent, call rather than wait.');
    expect(withPhone).toMatch(/href="tel:\+38641234567"[^>]*data-testid="guest-sent-call-call"/);
    expect(renderToString(<SentRecap snapshot={snapshot} locale="en" onAgain={() => {}} />)).not.toContain('tel:');
  });
});
