import { createHash, createHmac } from 'node:crypto';
import type postgres from 'postgres';
import { canonicalInput } from './canonical-input.server';
import { serverEnv } from './env.server';
import { utcWindow } from './guest-counters.server';
import type { SectionCategory } from './guide-validation';
import {
  asSectionCategory,
  duplicateWindowMinutes,
  guestMessageFields,
  inboxInput,
  messageActionInput,
  messageLimits,
  setAnswerInGuideInput,
  type GuestMessageFields,
  type MessageKind,
} from './message-validation';
import { withActiveGuestLink } from './share.server';

// Canonical guest-message layer: intake runs inside the validated link context, where RLS permits
// inserts only into the link's own published property; inbox reads and actions run inside the owner
// context. Guest text never leaves this layer for translation, AI, logs, or the alert mail.

export type InboxMessage = {
  id: string;
  kind: MessageKind;
  category: SectionCategory | null;
  locale: string;
  body: string;
  followUpEmail: string | null;
  state: 'new' | 'handled';
  answerInGuide: boolean | null;
  handledAt: string | null;
  createdAt: string;
};

export type SubmitGuestMessageResult =
  | { state: 'ok'; propertyId: string; alertEmail: string | null }
  | { state: 'duplicate' }
  | { state: 'rate_limited' }
  | { state: 'denied' };

export type GuestMessageInput = {
  shareId: string;
  sessionToken: string | null;
  message: GuestMessageFields;
};

function fingerprint(scope: string, value: string): Buffer {
  return createHmac('sha256', serverEnv.shareHmacKey).update(`${scope}:${value}`).digest();
}

// Session limits key on an HMAC of the random guest session token; link and property limits reuse
// the link and property ids. Raw tokens and identifiers never reach the counter table.
export function messageRateFingerprints(input: { shareId: string; propertyId: string; sessionToken: string }): {
  session: Buffer;
  link: Buffer;
  property: Buffer;
} {
  return {
    session: fingerprint('guest-message:session', input.sessionToken),
    link: fingerprint('guest-message:link', input.shareId),
    property: fingerprint('guest-message:property', input.propertyId),
  };
}

// Hashing the body and the optional address keeps the duplicate key stable without storing either in
// it, and the key covers the full canonical submission, so only an exact retry is suppressed.
export function duplicateFingerprint(input: {
  sessionToken: string;
  kind: MessageKind;
  category: SectionCategory;
  locale: string;
  body: string;
  replyEmail: string | null;
}): Buffer {
  const bodyHash = createHash('sha256').update(input.body).digest('hex');
  const replyHash = input.replyEmail === null ? '-' : createHash('sha256').update(input.replyEmail).digest('hex');
  return fingerprint(
    'guest-message:duplicate',
    `${input.sessionToken}:${input.kind}:${input.category}:${input.locale}:${bodyHash}:${replyHash}`,
  );
}

// Atomic fixed-window counter: concurrent submissions cannot both read the same pre-increment value.
async function bumpRate(
  tx: postgres.TransactionSql,
  propertyId: string,
  keyHash: Buffer,
  windowStart: Date,
): Promise<number> {
  const [row] = await tx<{ count: number }[]>`
    insert into app.rate_limits (property_id, key_hash, window_start, count)
    values (${propertyId}, ${keyHash}, ${windowStart}, 1)
    on conflict (key_hash, window_start) do update set count = app.rate_limits.count + 1
    returning count
  `;
  return row?.count ?? Number.MAX_SAFE_INTEGER;
}

export async function submitGuestMessage(input: GuestMessageInput): Promise<SubmitGuestMessageResult> {
  const message = canonicalInput(guestMessageFields, input.message);
  const outcome = await withActiveGuestLink(
    { shareId: input.shareId, sessionToken: input.sessionToken },
    async (tx, link) => {
      const fingerprints = messageRateFingerprints({
        shareId: input.shareId,
        propertyId: link.propertyId,
        sessionToken: link.sessionToken,
      });
      const hour = utcWindow(3600);
      const sessionCount = await bumpRate(tx, link.propertyId, fingerprints.session, hour);
      const linkCount = await bumpRate(tx, link.propertyId, fingerprints.link, hour);
      const propertyCount = await bumpRate(tx, link.propertyId, fingerprints.property, utcWindow(86_400));
      // Denials commit their increments, so a flood keeps the window closed instead of resetting it.
      if (
        sessionCount > messageLimits.sessionPerHour ||
        linkCount > messageLimits.linkPerHour ||
        propertyCount > messageLimits.propertyPerDay
      ) {
        return { state: 'rate_limited' } as const;
      }
      const followUpEmail = message.replyEmail === '' ? null : message.replyEmail;
      const duplicateKey = duplicateFingerprint({
        sessionToken: link.sessionToken,
        kind: message.kind,
        category: message.category,
        locale: message.locale,
        body: message.body,
        replyEmail: followUpEmail,
      });
      if ((await bumpRate(tx, link.propertyId, duplicateKey, utcWindow(duplicateWindowMinutes * 60))) > 1) {
        return { state: 'duplicate' } as const;
      }
      // No RETURNING: guests have no SELECT policy over stored messages, and RETURNING would need one.
      await tx`
        insert into app.guest_messages (property_id, kind, category, locale, body, follow_up_email)
        values (${link.propertyId}, ${message.kind}, ${message.category}, ${message.locale}, ${message.body}, ${followUpEmail})
      `;
      // Same-transaction housekeeping keeps the fingerprint table to live windows only.
      await tx`delete from app.rate_limits where window_start < ${utcWindow(86_400)}`;
      const [property] = await tx<{ alert_email: string | null }[]>`
        select alert_email from app.properties where id = ${link.propertyId}
      `;
      return {
        state: 'ok',
        propertyId: link.propertyId,
        alertEmail: property?.alert_email ?? null,
      } as const;
    },
  );
  return outcome ?? { state: 'denied' };
}

type InboxRow = {
  id: string;
  kind: string;
  category: string | null;
  locale: string;
  body: string;
  follow_up_email: string | null;
  state: string;
  answer_in_guide: boolean | null;
  handled_at: Date | null;
  created_at: Date;
};

function toInboxMessage(row: InboxRow): InboxMessage {
  return {
    id: row.id,
    kind: row.kind === 'issue' ? 'issue' : 'question',
    category: asSectionCategory(row.category),
    locale: row.locale,
    body: row.body,
    followUpEmail: row.follow_up_email,
    state: row.state === 'handled' ? 'handled' : 'new',
    answerInGuide: row.answer_in_guide,
    handledAt: row.handled_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

// Newest-first, property-scoped, verbatim guest text: the inbox is the only place guest words live.
export async function readInbox(tx: postgres.TransactionSql, propertyId: string): Promise<InboxMessage[]> {
  const parsed = canonicalInput(inboxInput, { propertyId });
  const rows = await tx<InboxRow[]>`
    select id, kind, category, locale, body, follow_up_email, state, answer_in_guide, handled_at, created_at
    from app.guest_messages
    where property_id = ${parsed.propertyId}
    order by created_at desc, id desc
  `;
  return rows.map(toInboxMessage);
}

export async function markMessageHandled(
  tx: postgres.TransactionSql,
  input: { propertyId: string; messageId: string },
): Promise<boolean> {
  const parsed = canonicalInput(messageActionInput, input);
  const rows = await tx`
    update app.guest_messages set state = 'handled', handled_at = now()
    where id = ${parsed.messageId} and property_id = ${parsed.propertyId} and state = 'new'
    returning id
  `;
  return rows.length === 1;
}

// The tag applies to questions only; a repeated value is a no-op, so only a real change is a change.
export async function setMessageAnswerInGuide(
  tx: postgres.TransactionSql,
  input: { propertyId: string; messageId: string; answerInGuide: boolean },
): Promise<boolean> {
  const parsed = canonicalInput(setAnswerInGuideInput, input);
  const rows = await tx`
    update app.guest_messages set answer_in_guide = ${parsed.answerInGuide}
    where id = ${parsed.messageId} and property_id = ${parsed.propertyId} and kind = 'question'
      and answer_in_guide is distinct from ${parsed.answerInGuide}
    returning id
  `;
  return rows.length === 1;
}

export async function deleteMessage(
  tx: postgres.TransactionSql,
  input: { propertyId: string; messageId: string },
): Promise<boolean> {
  const parsed = canonicalInput(messageActionInput, input);
  const rows = await tx`
    delete from app.guest_messages
    where id = ${parsed.messageId} and property_id = ${parsed.propertyId}
    returning id
  `;
  return rows.length === 1;
}
