// Settings "Security activity" through the real server function: owner-only, action filter, limit. Synthetic data only.
import { describe, expect, it } from 'vitest';
import type { SecurityEvent } from '../features/host/settings.server';
import {
  SETTINGS_FNS,
  adminClient,
  decode,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  fnCall,
  localAdmin,
  verifiedHost,
  type LocalStack,
} from './integration-helpers';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp ? describe : describe.skip;

const AGENT_FNS = '/src/features/agent/agent-fns.ts?tss-serverfn-split';

describeLocal('security activity against the local stack', () => {
  it('lists the newest 20 own security events without tool calls or other owners', async () => {
    const local = localStack as LocalStack;
    const hostA = await verifiedHost(local, 'activity-a');
    const hostB = await verifiedHost(local, 'activity-b');
    const admin = localAdmin();
    try {
      const created = await fnCall(AGENT_FNS, 'createAgentToken', {
        jar: hostA.jar,
        data: { name: 'Activity laptop', scopes: ['read'], propertyId: null, days: 30 },
      });
      expect(decode<{ token: string }>(created)?.result?.token).toBeTruthy();
      const [grant] = await admin<{ id: string }[]>`select id from app.agent_grants where owner_id = ${hostA.userId}`;
      const digest = Buffer.alloc(32, 7);
      for (let minute = 1; minute <= 25; minute += 1) {
        await admin`insert into app.audit_events (actor_id, action, created_at)
          values (${hostA.userId}, 'sign_in', now() - make_interval(mins => ${minute}))`;
      }
      await admin`insert into app.audit_events (actor_id, action, created_at) values (${hostA.userId}, 'publish', now() + interval '1 minute')`;
      await admin`insert into app.audit_events (actor_id, action, grant_id, tool, outcome, latency_ms, args_digest, created_at)
        values (${hostA.userId}, 'agent_tool_call', ${grant!.id}, 'list_properties', 'ok', 5, ${digest}, now() + interval '1 minute')`;
      await admin`insert into app.audit_events (actor_id, action, created_at) values (${hostB.userId}, 'sign_in', now() + interval '1 minute')`;

      const reply = await fnCall(SETTINGS_FNS, 'getSecurityActivity', { jar: hostA.jar });
      const events = decode<{ events: SecurityEvent[] }>(reply)?.result?.events ?? [];
      expect(events).toHaveLength(20);
      expect(events.map((event) => event.action).slice(0, 2)).toEqual(['agent_grant_created', 'mfa_enrolled']);
      expect(events[0]?.grantName).toBe('Activity laptop');
      expect(events.slice(2).every((event) => event.action === 'sign_in')).toBe(true);
      const times = events.map((event) => event.at);
      expect([...times].sort().reverse()).toEqual(times);

      const unauthenticated = await fnCall(SETTINGS_FNS, 'getSecurityActivity');
      expect(decode<{ error?: string }>(unauthenticated)?.result?.error).toBeTruthy();
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(hostA.userId);
      await adminClient(local).deleteUser(hostB.userId);
    }
  });
});
