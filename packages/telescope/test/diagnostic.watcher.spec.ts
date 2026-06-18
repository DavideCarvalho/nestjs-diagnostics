import { emit, getChannel, resetRegistry, setContextAccessor } from '@dudousxd/nestjs-diagnostics';
import { collectWatcherEntries } from '@dudousxd/nestjs-telescope-testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DiagnosticEntryContent,
  DiagnosticWatcher,
  buildDiagnosticEntry,
  isDiagnosticEvent,
} from '../src/diagnostic.watcher.js';

describe('DiagnosticWatcher', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetRegistry();
    setContextAccessor(null);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    setContextAccessor(null);
  });

  it('records a diagnostic entry per emitted event with payload + tags', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('billing', 'invoice-paid', { invoiceId: 'inv_123', amount: 4200 });

    expect(recorded).toHaveLength(1);
    const input = recorded[0];
    expect(input?.type).toBe('diagnostic');
    expect(input?.familyHash).toBe('billing:invoice-paid');
    expect(input?.tags).toEqual(['lib:billing', 'event:invoice-paid']);
    expect(input?.content).toMatchObject<DiagnosticEntryContent>({
      lib: 'billing',
      event: 'invoice-paid',
      ts: expect.any(Number),
      traceId: null,
      payload: { invoiceId: 'inv_123', amount: 4200 },
    });
  });

  it('carries the envelope traceId into content + a trace tag', async () => {
    setContextAccessor({
      traceId: () => 'trace-xyz',
      tenantId: () => undefined,
      userRef: () => undefined,
      get: () => undefined,
    });
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('audit', 'login', { userId: 7 });

    const input = recorded[0];
    expect((input?.content as DiagnosticEntryContent).traceId).toBe('trace-xyz');
    expect(input?.tags).toContain('trace:trace-xyz');
  });

  it('auto-subscribes to channels registered AFTER register (future channels)', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    // This lib's channel did not exist when the watcher registered.
    emit('jobs', 'completed', { id: 'j1' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.familyHash).toBe('jobs:completed');
  });

  it('subscribes to channels that already existed at register time', async () => {
    // Touch a channel before the watcher registers, but emit while listening.
    emit('cache', 'evicted', { key: 'a' }); // registers aviary:cache:evicted (no subscriber yet)

    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('cache', 'evicted', { key: 'b' });

    expect(recorded).toHaveLength(1);
    expect((recorded[0]?.content as DiagnosticEntryContent).payload).toEqual({ key: 'b' });
  });

  it('records the envelope schema version (v) when present', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('billing', 'invoice-paid', { ok: true });

    const content = recorded[0]?.content as DiagnosticEntryContent;
    expect(content.v).toBe(1);
  });

  it('tolerates a legacy envelope without v (records v as null)', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    // Simulate an already-published emitter that predates schema versioning:
    // register the channel (so the watcher auto-subscribes), then publish a raw
    // envelope with no `v` field directly on it.
    const channel = getChannel('legacy', 'event');
    channel.publish({
      ts: Date.now(),
      lib: 'legacy',
      event: 'event',
      payload: { ok: true },
    });

    expect(recorded).toHaveLength(1);
    const content = recorded[0]?.content as DiagnosticEntryContent;
    expect(content.lib).toBe('legacy');
    expect(content.v).toBeNull();
  });

  it('isDiagnosticEvent accepts envelopes with and without v', () => {
    const base = { ts: 1, lib: 'a', event: 'b', payload: {} };
    expect(isDiagnosticEvent(base)).toBe(true);
    expect(isDiagnosticEvent({ ...base, v: 1 })).toBe(true);
    // A malformed v (non-number) is rejected.
    expect(isDiagnosticEvent({ ...base, v: 'nope' })).toBe(false);
  });

  it('buildDiagnosticEntry maps v through, defaulting absent v to null', () => {
    const withV = buildDiagnosticEntry({ v: 2, ts: 1, lib: 'a', event: 'b', payload: {} });
    expect((withV.content as DiagnosticEntryContent).v).toBe(2);
    const withoutV = buildDiagnosticEntry({ ts: 1, lib: 'a', event: 'b', payload: {} });
    expect((withoutV.content as DiagnosticEntryContent).v).toBeNull();
  });

  it('cleanup() unsubscribes so later events are ignored', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    watcher.cleanup();

    emit('billing', 'invoice-paid', {});

    expect(recorded).toHaveLength(0);
  });
});
