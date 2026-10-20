import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAudit } from './audit.server';
import { logEvent } from './log.server';

const { sql, withOwnerContext } = vi.hoisted(() => ({ sql: vi.fn(), withOwnerContext: vi.fn() }));
vi.mock('./db.server', () => ({ sql, withOwnerContext }));
vi.mock('./log.server', () => ({ logEvent: vi.fn() }));

beforeEach(() => {
  sql.mockReset();
  withOwnerContext.mockReset();
  vi.mocked(logEvent).mockReset();
});

describe('recordAudit', () => {
  it('writes actor-attributed rows inside the owner context', async () => {
    withOwnerContext.mockResolvedValue(undefined);
    await recordAudit('owner-1', 'publish');
    expect(withOwnerContext).toHaveBeenCalledWith('owner-1', expect.any(Function));
    expect(sql).not.toHaveBeenCalled();
  });

  it('writes anonymous rows with the plain client', async () => {
    await recordAudit(null, 'callback_failure');
    expect(sql).toHaveBeenCalledTimes(1);
    expect(withOwnerContext).not.toHaveBeenCalled();
  });

  it('never breaks the caller when the write fails', async () => {
    withOwnerContext.mockRejectedValue(new Error('db down SYNTHETIC'));
    await expect(recordAudit('owner-1', 'publish')).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith('audit_write_failed', { appEnv: expect.any(String), status: 500 });
  });
});
