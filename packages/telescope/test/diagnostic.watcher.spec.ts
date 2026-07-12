import {
  claimDiagnostics,
  emit,
  getChannel,
  resetRegistry,
  setContextAccessor,
} from '@dudousxd/nestjs-diagnostics';
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

  it('carries durationMs from DiagnosticEvent into RecordInput when present', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('ai', 'chat-request', { model: 'gpt-4o' }, { durationMs: 7 });

    expect(recorded[0]?.durationMs).toBe(7);
  });

  it('leaves durationMs undefined on RecordInput when not provided', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('ai', 'chat-request', { model: 'gpt-4o' });

    expect(recorded[0]?.durationMs).toBeUndefined();
  });

  it('buildDiagnosticEntry passes durationMs from envelope to RecordInput', () => {
    const withDuration = buildDiagnosticEntry({
      ts: 1,
      lib: 'ai',
      event: 'chat-request',
      payload: {},
      durationMs: 7,
    });
    expect(withDuration.durationMs).toBe(7);

    const withoutDuration = buildDiagnosticEntry({
      ts: 1,
      lib: 'ai',
      event: 'chat-request',
      payload: {},
    });
    expect(withoutDuration.durationMs).toBeUndefined();
  });

  it('skips events whose lib:event is in the exclude set', async () => {
    const watcher = new DiagnosticWatcher({ exclude: ['media:upload.progress'] });
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('media', 'upload.progress', { offset: 1024 });
    emit('media', 'upload.progress', { offset: 2048 });

    expect(recorded).toHaveLength(0);
  });

  it('records sibling events on an excluded lib (only the muted event is dropped)', async () => {
    const watcher = new DiagnosticWatcher({ exclude: ['media:upload.progress'] });
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('media', 'upload.progress', { offset: 1024 }); // muted
    emit('media', 'upload.complete', { id: 'u1' }); // kept

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.familyHash).toBe('media:upload.complete');
  });

  it('records everything when no exclude set is configured', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('media', 'upload.progress', { offset: 1024 });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.familyHash).toBe('media:upload.progress');
  });

  it('cleanup() unsubscribes so later events are ignored', async () => {
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    watcher.cleanup();

    emit('billing', 'invoice-paid', {});

    expect(recorded).toHaveLength(0);
  });

  it('skips a claimed lib:event by default (a lib-specific watcher already records it)', async () => {
    const release = claimDiagnostics('agent', ['chat-request']);
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => {
      watcher.cleanup();
      release();
    };

    emit('agent', 'chat-request', { model: 'gpt-4o' });

    expect(recorded).toHaveLength(0);
  });

  it('records a claimed lib:event when recordClaimed: true is set', async () => {
    const release = claimDiagnostics('agent', ['chat-request']);
    const watcher = new DiagnosticWatcher({ recordClaimed: true });
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => {
      watcher.cleanup();
      release();
    };

    emit('agent', 'chat-request', { model: 'gpt-4o' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.familyHash).toBe('agent:chat-request');
  });

  it('manual exclude still wins independently of claim status', async () => {
    const release = claimDiagnostics('agent', ['chat-request']);
    // recordClaimed: true would otherwise record it, but exclude mutes it outright.
    const watcher = new DiagnosticWatcher({
      recordClaimed: true,
      exclude: ['agent:chat-request'],
    });
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => {
      watcher.cleanup();
      release();
    };

    emit('agent', 'chat-request', { model: 'gpt-4o' });

    expect(recorded).toHaveLength(0);
  });

  it('leaves unclaimed lib:event keys unaffected', async () => {
    const release = claimDiagnostics('agent', ['chat-request']);
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => {
      watcher.cleanup();
      release();
    };

    // Sibling event on the same lib, never claimed.
    emit('agent', 'tool-call', { tool: 'search' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.familyHash).toBe('agent:tool-call');
  });

  it('un-claiming (release) makes the watcher record the event again', async () => {
    const release = claimDiagnostics('agent', ['chat-request']);
    const watcher = new DiagnosticWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('agent', 'chat-request', { model: 'gpt-4o' }); // claimed → skipped
    release();
    emit('agent', 'chat-request', { model: 'gpt-4o' }); // unclaimed → recorded

    expect(recorded).toHaveLength(1);
  });
});
