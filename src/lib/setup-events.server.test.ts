import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logEvent } from './log.server';
import { recordSetupEvent } from './setup-events.server';

const { withOwnerContext } = vi.hoisted(() => ({ withOwnerContext: vi.fn() }));
vi.mock('./db.server', () => ({ withOwnerContext }));
vi.mock('./log.server', () => ({ logEvent: vi.fn() }));

beforeEach(() => {
  withOwnerContext.mockReset();
  vi.mocked(logEvent).mockReset();
});

async function sqlText(run: () => Promise<void>): Promise<string> {
  const tx = vi.fn().mockResolvedValue([]);
  withOwnerContext.mockImplementation(async (_owner: string, work: (tx: unknown) => unknown) => work(tx));
  await run();
  return tx.mock.calls[0]![0].join('?');
}

describe('recordSetupEvent', () => {
  it('inserts an owner-level event', async () => {
    const text = await sqlText(() => recordSetupEvent('owner-1', 'sign_in'));
    expect(withOwnerContext).toHaveBeenCalledWith('owner-1', expect.any(Function));
    expect(text).not.toContain('app.properties');
  });

  it('scopes a property event to a property the owner can see', async () => {
    const text = await sqlText(() =>
      recordSetupEvent('owner-1', 'publish_clicked', { propertyId: 'p1', step: 'copy' }),
    );
    expect(text).toContain('from app.properties');
  });

  it('never fails the host action when the write fails', async () => {
    withOwnerContext.mockRejectedValue(new Error('db down'));
    await expect(recordSetupEvent('owner-1', 'sign_in')).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith('setup_event_write_failed', expect.objectContaining({ status: 500 }));
  });
});
