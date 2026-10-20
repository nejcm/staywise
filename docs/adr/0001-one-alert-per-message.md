# 0001: One host alert email per guest message

**Status:** accepted, 2026-10-21

## Context

Each stored guest message sends one fixed-content alert (no body, category, property name, or reply address). The open question was whether to throttle or batch alerts.

## Decision

No extra throttling. Volume is already bounded upstream by the intake limits in `messageLimits` (`src/features/messages/message-validation.ts`): 5 messages per guest session per hour, 20 per link per hour, 100 per property per day. A property therefore sends at most 100 alerts a day, and an alert carries no guest content.

## Consequences

- A host can still receive up to 100 alerts in a day under abuse. The kill switch (`GUEST_ACCESS_DISABLED`) or link rotation stops it.
- Batching or digests would need alert-state storage and a scheduled sender; revisit only if pilot hosts report alert fatigue.
- `messages.server.test.ts` and the integration suite keep asserting one alert per stored message.
