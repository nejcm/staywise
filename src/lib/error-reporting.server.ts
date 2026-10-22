import { PostHog } from 'posthog-node';
import { appEnv, serverEnv } from './env.server';
import { logEvent, safeFields, type LogFields } from './log.server';

const SEND_TIMEOUT_MS = 2000;

type Frame = Record<string, unknown>;
type CapturedEvent = { properties?: { $exception_list?: { value?: unknown; stacktrace?: { frames?: Frame[] } }[] } };

// The exception message can echo request data and source context lines are not needed: keep type and code locations only.
export function scrubException<T extends CapturedEvent>(event: T): T {
  for (const exception of event.properties?.$exception_list ?? []) {
    exception.value = '';
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.pre_context;
      delete frame.context_line;
      delete frame.post_context;
    }
  }
  return event;
}

// Share-link and other ids in a path identify a guest stay or a host's property; PostHog gets the route shape only.
export function redactPath(path: string): string {
  return path
    .replace(/^\/g\/[^/]+/, '/g/:shareId')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id');
}

const client = serverEnv.posthog
  ? new PostHog(serverEnv.posthog.apiKey, {
      host: serverEnv.posthog.host,
      before_send: (event) => (event ? scrubException(event as CapturedEvent & typeof event) : null),
    })
  : null;

// Stdout line plus an optional PostHog event; reporting must never fail or noticeably delay the request that errored.
export async function reportServerError(error: unknown, fields: LogFields): Promise<void> {
  logEvent('server_error', fields);
  // A returned 5xx carries no exception, so there is nothing useful to send and no reason to delay the response.
  if (!client || error === undefined) return;
  const properties: Record<string, string | number> = safeFields(fields);
  if (typeof properties.path === 'string') properties.path = redactPath(properties.path);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.captureExceptionImmediate(error, undefined, properties),
      new Promise((resolve) => {
        timer = setTimeout(resolve, SEND_TIMEOUT_MS);
      }),
    ]);
  } catch {
    logEvent('error_report_failed', { appEnv, status: 500 });
  } finally {
    clearTimeout(timer);
  }
}
