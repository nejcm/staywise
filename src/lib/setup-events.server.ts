import { withOwnerContext } from './db.server';
import { appEnv } from './env.server';
import { logEvent } from './log.server';

export type SetupEventType =
  | 'sign_in'
  | 'property_created'
  | 'section_saved'
  | 'preview_opened'
  | 'publish_clicked'
  | 'support_requested';

// Pilot instrumentation only: host-scoped, never shown to hosts, and never allowed to fail a host
// action. A property-scoped event inserts only when that property is owned in the same context.
export async function recordSetupEvent(
  ownerId: string,
  eventType: SetupEventType,
  context: { propertyId?: string; step?: string } = {},
): Promise<void> {
  try {
    const step = context.step ?? null;
    if (context.propertyId) {
      const propertyId = context.propertyId;
      await withOwnerContext(
        ownerId,
        (tx) => tx`
          insert into app.setup_events (owner_id, event_type, property_id, step)
          select ${ownerId}, ${eventType}, p.id, ${step} from app.properties p where p.id = ${propertyId}
        `,
      );
      return;
    }
    await withOwnerContext(
      ownerId,
      (tx) => tx`insert into app.setup_events (owner_id, event_type, step) values (${ownerId}, ${eventType}, ${step})`,
    );
  } catch {
    logEvent('setup_event_write_failed', { appEnv, status: 500 });
  }
}
