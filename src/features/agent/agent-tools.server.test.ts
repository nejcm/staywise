import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withOwnerContext } from '../../lib/db.server';
import type { AgentPrincipal } from './agent-auth.server';
import { runTool } from './agent-tools.server';

vi.mock('../../lib/db.server', () => ({ sql: vi.fn(), withOwnerContext: vi.fn() }));

const owned = '00000000-0000-4000-8000-0000000000a1';
const other = '00000000-0000-4000-8000-0000000000b1';
const principal: AgentPrincipal = {
  grantId: '00000000-0000-4000-8000-000000000001',
  ownerId: '00000000-0000-4000-8000-000000000002',
  scopes: ['read'],
  propertyId: null,
};

let audits: unknown[][];
const tx = vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
  audits.push(values);
  return Promise.resolve([]);
});

beforeEach(() => {
  audits = [];
  tx.mockClear();
  vi.mocked(withOwnerContext)
    .mockReset()
    .mockImplementation((_owner, work) => work(tx as never));
});

const outcome = () => audits.at(-1)?.[5];
const digest = () => audits.at(-1)?.[7] as Buffer;

describe('runTool', () => {
  it('runs owner-scoped and audits ok with property ids and row count', async () => {
    const work = vi.fn().mockResolvedValue({ data: { ok: 1 }, propertyIds: [owned], rowCount: 3 });
    const result = await runTool(principal, 'get_property', 'read', { propertyId: owned }, work);
    expect(withOwnerContext).toHaveBeenCalledWith(principal.ownerId, expect.any(Function));
    expect(work).toHaveBeenCalledWith(tx, owned);
    expect(result).toEqual({ content: [{ type: 'text', text: '{"ok":1}' }], structuredContent: { ok: 1 } });
    expect(audits.at(-1)?.slice(0, 6)).toEqual([
      principal.ownerId,
      principal.grantId,
      'get_property',
      [owned],
      3,
      'ok',
    ]);
  });

  it('denies a property outside the token restriction as an isError result', async () => {
    const work = vi.fn();
    const result = await runTool(
      { ...principal, propertyId: owned },
      'list_inbox',
      'read',
      { propertyId: other },
      work,
    );
    expect(result.isError).toBe(true);
    expect(work).not.toHaveBeenCalled();
    expect(outcome()).toBe('denied');
  });

  it('scopes an unfiltered call to the restricted property', async () => {
    const work = vi.fn().mockResolvedValue({ data: {}, propertyIds: [owned], rowCount: 0 });
    await runTool({ ...principal, propertyId: owned }, 'list_reservations', 'read', {}, work);
    expect(work).toHaveBeenCalledWith(tx, owned);
  });

  it('denies a tool outside the token scopes', async () => {
    const work = vi.fn();
    const result = await runTool({ ...principal, scopes: ['inbox:write'] }, 'list_inbox', 'read', {}, work);
    expect(result.isError).toBe(true);
    expect(work).not.toHaveBeenCalled();
    expect(outcome()).toBe('denied');
  });

  it('answers a missing or foreign row as not found', async () => {
    const result = await runTool(principal, 'get_property', 'read', { propertyId: other }, async () => null);
    expect(result).toEqual({ content: [{ type: 'text', text: 'Not found.' }], isError: true });
    expect(outcome()).toBe('ok');
  });

  it('hides failure details and audits the error', async () => {
    const result = await runTool(principal, 'get_property', 'read', { propertyId: owned }, () =>
      Promise.reject(new Error('relation app.property_credentials wifi_password=hunter2')),
    );
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(result.isError).toBe(true);
    expect(outcome()).toBe('error');
  });

  it('digests canonical arguments, never storing them', async () => {
    const work = async () => ({ data: {}, propertyIds: [], rowCount: 0 });
    await runTool(principal, 'list_inbox', 'read', { propertyId: owned, limit: 5 }, work);
    const first = digest();
    await runTool(principal, 'list_inbox', 'read', { limit: 5, propertyId: owned }, work);
    expect(digest().equals(first)).toBe(true);
    expect(first).toHaveLength(32);
    expect(JSON.stringify(audits)).not.toContain('"limit"');
  });
});
