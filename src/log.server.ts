const eventNames = [
  'server_error',
  'audit_write_failed',
  'mail_send_failed',
  'otp_send_failed',
  'setup_event_write_failed',
  'translation_provider_failed',
  'counter_write_failed',
] as const;
const fieldNames = ['requestId', 'appEnv', 'method', 'path', 'status', 'outcome'] as const;

export type LogEvent = (typeof eventNames)[number];
export type LogFields = Partial<Record<(typeof fieldNames)[number], string | number>>;

// Log output stays an allowlisted, flat scalar set; unknown events/fields and non-scalar values are dropped so message bodies, fragments, and nested payloads cannot reach logs.
export function logEvent(event: LogEvent, fields: LogFields = {}) {
  const safe: Record<string, string | number> = {
    event: (eventNames as readonly string[]).includes(event) ? event : 'invalid_event',
  };
  for (const name of fieldNames) {
    const value = fields[name];
    if (typeof value === 'string' || typeof value === 'number') {
      safe[name] = value;
    }
  }
  console.log(JSON.stringify(safe));
}
