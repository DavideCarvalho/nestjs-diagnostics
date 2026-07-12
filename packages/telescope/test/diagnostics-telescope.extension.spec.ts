import {
  claimDiagnostics,
  emit,
  resetRegistry,
  setContextAccessor,
} from '@dudousxd/nestjs-diagnostics';
import {
  type Entry,
  type ExtensionContext,
  InMemoryStorageProvider,
  TELESCOPE_STORAGE,
  resolveConfig,
} from '@dudousxd/nestjs-telescope';
import { collectWatcherEntries } from '@dudousxd/nestjs-telescope-testing';
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_ENTRY_TYPE, type DiagnosticEntryContent } from '../src/diagnostic.watcher.js';
import { nestjsDiagnosticsTelescope } from '../src/diagnostics-telescope.extension.js';

let seq = 0;

/** Build a stored `diagnostic` Entry from envelope content. */
function diagnosticEntry(content: DiagnosticEntryContent): Entry<DiagnosticEntryContent> {
  const n = seq++;
  return {
    id: `e${n}`,
    batchId: 'b',
    type: DIAGNOSTIC_ENTRY_TYPE,
    familyHash: `${content.lib}:${content.event}`,
    content,
    tags: [`lib:${content.lib}`, `event:${content.event}`],
    sequence: n,
    durationMs: null,
    origin: 'http',
    instanceId: 'i',
    traceId: content.traceId,
    spanId: null,
    createdAt: new Date(2026, 0, 1, 0, 0, n),
  };
}

async function makeCtx(): Promise<{ ctx: ExtensionContext; storage: InMemoryStorageProvider }> {
  const storage = new InMemoryStorageProvider();
  const ctx: ExtensionContext = {
    config: resolveConfig({}),
    moduleRef: {
      get: (token: unknown) => {
        if (token === TELESCOPE_STORAGE) return storage;
        throw new Error('unknown token');
      },
    } as unknown as ExtensionContext['moduleRef'],
  };
  return { ctx, storage };
}

describe('nestjsDiagnosticsTelescope extension', () => {
  it('contributes one generic watcher, an entry type, a dashboard and providers', () => {
    const ext = nestjsDiagnosticsTelescope();
    // The name must be the 'diagnostics' namespace — equal to the dashboard-id
    // prefix and the provider-name prefix — or Telescope's per-provider ownership
    // check 404s every panel (see the comment on `name` in the extension).
    expect(ext.name).toBe('diagnostics');

    const fakeCtx = {} as ExtensionContext;
    expect(ext.watchers?.(fakeCtx).map((w) => w.type)).toEqual(['diagnostic']);
    expect(ext.entryTypes?.(fakeCtx)).toEqual([
      { id: 'diagnostic', label: 'Diagnostics', dot: 'bg-sky-400' },
    ]);

    const dashboards = ext.dashboards?.(fakeCtx) ?? [];
    expect(dashboards.map((d) => d.id)).toEqual(['diagnostics.diagnostics']);
    expect(dashboards[0]?.panels.map((p) => p.kind)).toEqual(['stat', 'topN', 'topN', 'table']);

    const providerNames = ext.dataProviders?.(fakeCtx).map((p) => p.name) ?? [];
    expect(providerNames).toEqual([
      'diagnostics.count',
      'diagnostics.byLib',
      'diagnostics.topEvents',
      'diagnostics.recentEvents',
    ]);
    // Invariant the 404 bug violated: every provider is owned by the namespace the
    // UI derives from the dashboard id (dashboardId.split('.')[0]).
    const navPrefix = (dashboards[0]?.id ?? '').split('.')[0];
    expect(navPrefix).toBe(ext.name);
    for (const name of providerNames) {
      expect(name.split('.')[0]).toBe(ext.name);
    }
  });

  it('threads the exclude option into the watcher so muted events are not recorded', async () => {
    resetRegistry();
    setContextAccessor(null);
    const [watcher] =
      nestjsDiagnosticsTelescope({ exclude: ['media:upload.progress'] }).watchers?.(
        {} as ExtensionContext,
      ) ?? [];
    if (!watcher) throw new Error('extension contributed no watcher');
    const { recorded } = await collectWatcherEntries(watcher);

    emit('media', 'upload.progress', { offset: 1024 }); // muted by exclude
    emit('media', 'upload.complete', { id: 'u1' }); // kept

    watcher.cleanup?.();
    setContextAccessor(null);
    expect(recorded.map((r) => r.familyHash)).toEqual(['media:upload.complete']);
  });

  it('threads recordClaimed into the watcher so claimed events are recorded again', async () => {
    resetRegistry();
    setContextAccessor(null);
    const release = claimDiagnostics('agent', ['chat-request']);
    const [watcher] =
      nestjsDiagnosticsTelescope({ recordClaimed: true }).watchers?.({} as ExtensionContext) ?? [];
    if (!watcher) throw new Error('extension contributed no watcher');
    const { recorded } = await collectWatcherEntries(watcher);

    emit('agent', 'chat-request', { model: 'gpt-4o' });

    watcher.cleanup?.();
    release();
    setContextAccessor(null);
    expect(recorded.map((r) => r.familyHash)).toEqual(['agent:chat-request']);
  });

  it('defaults to skipping claimed events when recordClaimed is not set', async () => {
    resetRegistry();
    setContextAccessor(null);
    const release = claimDiagnostics('agent', ['chat-request']);
    const [watcher] = nestjsDiagnosticsTelescope().watchers?.({} as ExtensionContext) ?? [];
    if (!watcher) throw new Error('extension contributed no watcher');
    const { recorded } = await collectWatcherEntries(watcher);

    emit('agent', 'chat-request', { model: 'gpt-4o' });

    watcher.cleanup?.();
    release();
    setContextAccessor(null);
    expect(recorded).toHaveLength(0);
  });

  it('topEvents provider ranks lib:event pairs by count', async () => {
    const { ctx, storage } = await makeCtx();
    await storage.store([
      diagnosticEntry({ lib: 'billing', event: 'invoice-paid', ts: 1, traceId: null, payload: {} }),
      diagnosticEntry({ lib: 'billing', event: 'invoice-paid', ts: 2, traceId: null, payload: {} }),
      diagnosticEntry({ lib: 'audit', event: 'login', ts: 3, traceId: null, payload: {} }),
    ]);

    const provider = nestjsDiagnosticsTelescope()
      .dataProviders?.(ctx)
      .find((p) => p.name === 'diagnostics.topEvents');
    const result = (await provider?.resolve({}, ctx)) as {
      items: { label: string; value: number }[];
    };

    expect(result.items).toEqual([
      { label: 'billing:invoice-paid', value: 2 },
      { label: 'audit:login', value: 1 },
    ]);
  });

  it('recentEvents provider returns a table row per event', async () => {
    const { ctx, storage } = await makeCtx();
    await storage.store([
      diagnosticEntry({
        lib: 'jobs',
        event: 'completed',
        ts: 9,
        traceId: 'trace-1',
        payload: { id: 'j1' },
      }),
    ]);

    const provider = nestjsDiagnosticsTelescope()
      .dataProviders?.(ctx)
      .find((p) => p.name === 'diagnostics.recentEvents');
    const result = (await provider?.resolve({}, ctx)) as { rows: Record<string, unknown>[] };

    expect(result.rows).toEqual([
      { time: '00:00:00', lib: 'jobs', event: 'completed', durationMs: null, traceId: 'trace-1' },
    ]);
  });

  it('count provider returns the number of diagnostic entries', async () => {
    const { ctx, storage } = await makeCtx();
    await storage.store([
      diagnosticEntry({ lib: 'a', event: 'x', ts: 1, traceId: null, payload: {} }),
      diagnosticEntry({ lib: 'b', event: 'y', ts: 2, traceId: null, payload: {} }),
    ]);
    const provider = nestjsDiagnosticsTelescope()
      .dataProviders?.(ctx)
      .find((p) => p.name === 'diagnostics.count');
    expect(await provider?.resolve({}, ctx)).toEqual({ value: 2 });
  });

  it('byLib provider ranks libraries by event count', async () => {
    const { ctx, storage } = await makeCtx();
    await storage.store([
      diagnosticEntry({ lib: 'billing', event: 'a', ts: 1, traceId: null, payload: {} }),
      diagnosticEntry({ lib: 'billing', event: 'b', ts: 2, traceId: null, payload: {} }),
      diagnosticEntry({ lib: 'audit', event: 'c', ts: 3, traceId: null, payload: {} }),
    ]);
    const provider = nestjsDiagnosticsTelescope()
      .dataProviders?.(ctx)
      .find((p) => p.name === 'diagnostics.byLib');
    const result = (await provider?.resolve({}, ctx)) as {
      items: { label: string; value: number }[];
    };
    expect(result.items).toEqual([
      { label: 'billing', value: 2 },
      { label: 'audit', value: 1 },
    ]);
  });
});
