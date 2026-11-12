import diagnostics_channel from 'node:diagnostics_channel';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DiagnosticEvent,
  NESTJS_RESILIENCE_CHANNELS,
  emit,
  getChannel,
  resetRegistry,
  stopRecentEvents,
  trace,
} from '../src/index.js';
import {
  DEV_TOOLS_SLOT,
  type DiagnosticsDevTool,
  DiagnosticsModule,
  OnDiagnostic,
  transports,
} from '../src/nestjs/index.js';

interface SlotLib {
  lib: string;
  title: string;
  authorize?: unknown;
  tools: DiagnosticsDevTool[];
}

function slot():
  | { version: number; libs: SlotLib[]; supports?: (c: string) => boolean }
  | undefined {
  return (globalThis as Record<symbol, never>)[DEV_TOOLS_SLOT];
}

function tool(name: string): DiagnosticsDevTool {
  const found = slot()
    ?.libs.find((l) => l.lib === 'diagnostics')
    ?.tools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

@Injectable()
class Reactions {
  @OnDiagnostic('billing', 'paid')
  onPaid(_e: DiagnosticEvent) {}

  @OnDiagnostic('durable', /run\./)
  @OnDiagnostic('mail')
  onMany(_e: DiagnosticEvent) {}
}

async function boot(options: Parameters<typeof DiagnosticsModule.forRoot>[0] = {}) {
  const moduleRef = await Test.createTestingModule({
    imports: [DiagnosticsModule.forRoot(options)],
    providers: [Reactions],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

describe('diagnostics dev tools', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => {
    resetRegistry();
    delete (globalThis as Record<symbol, unknown>)[DEV_TOOLS_SLOT];
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = env;
    stopRecentEvents();
    delete (globalThis as Record<symbol, unknown>)[DEV_TOOLS_SLOT];
  });

  it('creates the slot and registers without authorize; removes itself on close', async () => {
    const app = await boot();
    const entry = slot()?.libs.find((l) => l.lib === 'diagnostics');
    expect(slot()?.version).toBe(1);
    expect(entry?.title).toBe('Diagnostics bus');
    expect(entry && 'authorize' in entry).toBe(false);
    expect(entry?.tools.map((t) => t.name)).toEqual([
      'diagnostics_list_channels',
      'diagnostics_list_listeners',
      'diagnostics_list_recent_events',
    ]);
    for (const t of entry?.tools ?? []) {
      expect(t.kind).toBe('read');
      expect(t.name).toMatch(/^diagnostics(_[a-z0-9]+)+$/);
      expect(t.input.type).toBe('object');
    }
    await app.close();
    expect(slot()?.libs).toEqual([]);
  });

  it('joins a slot another lib created', async () => {
    const libs: SlotLib[] = [];
    (globalThis as Record<symbol, unknown>)[DEV_TOOLS_SLOT] = {
      version: 1,
      libs,
      register(lib: SlotLib) {
        libs.push(lib);
        return () => libs.splice(libs.indexOf(lib), 1);
      },
      supports: (c: string) => c === 'endpoint-authorize',
    };
    const app = await boot();
    expect(libs.map((l) => l.lib)).toEqual(['diagnostics']);
    await app.close();
    expect(libs).toEqual([]);
  });

  it('stays out of a hub that cannot gate a lib without a console', async () => {
    const libs: SlotLib[] = [];
    (globalThis as Record<symbol, unknown>)[DEV_TOOLS_SLOT] = {
      version: 1,
      libs,
      register: (lib: SlotLib) => {
        libs.push(lib);
        return () => {};
      },
      supports: () => false,
    };
    const app = await boot();
    expect(libs).toEqual([]);
    await app.close();
  });

  it('stays out of a slot of another version, and with devTools: false', async () => {
    (globalThis as Record<symbol, unknown>)[DEV_TOOLS_SLOT] = { version: 2, libs: [] };
    const app = await boot();
    expect(slot()?.libs).toEqual([]);
    await app.close();
    delete (globalThis as Record<symbol, unknown>)[DEV_TOOLS_SLOT];
    const off = await boot({ devTools: false });
    expect(slot()).toBeUndefined();
    await off.close();
  });

  it('diagnostics_list_channels lists aviary and nestjs channels with subscriber counts', async () => {
    const app = await boot();
    getChannel('silent', 'tick');
    getChannel('billing', 'paid');
    const listener = () => {};
    diagnostics_channel.subscribe('aviary:billing:paid', listener);
    trace('jobs', 'run', () => 1);
    const all = (await tool('diagnostics_list_channels').run({ limit: 100 })) as {
      items: Array<{
        channel: string;
        lib: string;
        event: string;
        source: string;
        subscribers: number | null;
        spanSubscribers?: number | null;
      }>;
      next: number | null;
    };
    const byName = new Map(all.items.map((c) => [c.channel, c]));
    // The recent-events buffer and nothing else listens to silent:tick → 0.
    expect(byName.get('aviary:silent:tick')).toMatchObject({
      lib: 'silent',
      event: 'tick',
      source: 'aviary',
      subscribers: 0,
      spanSubscribers: 0,
    });
    // The @OnDiagnostic listener + the extra subscriber.
    expect(byName.get('aviary:billing:paid')?.subscribers).toBe(2);
    expect(byName.get(NESTJS_RESILIENCE_CHANNELS.retry)).toMatchObject({
      lib: 'resilience',
      event: 'retry',
      source: 'nestjs',
      subscribers: 0,
    });

    const silent = (await tool('diagnostics_list_channels').run({
      source: 'aviary',
      subscribed: false,
      limit: 100,
    })) as { items: Array<{ channel: string }> };
    expect(silent.items.map((c) => c.channel)).toContain('aviary:silent:tick');
    expect(silent.items.map((c) => c.channel)).not.toContain('aviary:billing:paid');

    const paged = (await tool('diagnostics_list_channels').run({ limit: 1, page: 2 })) as {
      items: unknown[];
      next: number | null;
    };
    expect(paged.items).toHaveLength(1);
    expect(paged.next).toBe(3);

    const billing = (await tool('diagnostics_list_channels').run({ lib: 'billing' })) as {
      items: Array<{ channel: string }>;
    };
    expect(billing.items.map((c) => c.channel)).toEqual(['aviary:billing:paid']);
    diagnostics_channel.unsubscribe('aviary:billing:paid', listener);
    await app.close();
  });

  it('diagnostics_list_listeners lists every matcher and the transport', async () => {
    const app = await boot();
    const local = (await tool('diagnostics_list_listeners').run({})) as {
      transport: unknown;
      items: unknown[];
    };
    expect(local.transport).toEqual({ name: null, kind: 'local', role: 'all' });
    expect(local.items).toEqual(
      expect.arrayContaining([
        { id: expect.stringMatching(/#onPaid$/), lib: 'billing', event: 'paid', method: 'onPaid' },
        {
          id: expect.stringMatching(/#onMany$/),
          lib: 'durable',
          event: '/run\\./',
          method: 'onMany',
        },
        { id: expect.stringMatching(/#onMany$/), lib: 'mail', event: '*', method: 'onMany' },
      ]),
    );
    const mail = (await tool('diagnostics_list_listeners').run({ lib: 'mail' })) as {
      items: unknown[];
    };
    expect(mail.items).toHaveLength(1);
    await app.close();
  });

  it('describes the selected transport by kind', async () => {
    const pub = { publish: async () => 0 } as never;
    const app = await boot({
      default: 'bus',
      role: 'api',
      transports: { bus: transports.redis({ pub }), mine: async () => ({}) },
    });
    const result = (await tool('diagnostics_list_listeners').run({})) as { transport: unknown };
    expect(result.transport).toEqual({ name: 'bus', kind: 'redis', role: 'api' });
    await app.close();
    const custom = await boot({ default: 'mine', transports: { mine: async () => ({}) } });
    const answer = (await tool('diagnostics_list_listeners').run({})) as { transport: unknown };
    expect(answer.transport).toEqual({ name: 'mine', kind: 'custom', role: 'all' });
    await custom.close();
  });

  it('diagnostics_list_recent_events reads the buffer with filters and pages', async () => {
    const app = await boot();
    emit('durable', 'run.started', { runId: 'r1' }, { traceId: 't1' });
    emit('durable', 'run.failed', { runId: 'r1', token: 'secret' }, { traceId: 't1' });
    emit('mail', 'sent', {}, { traceId: 't2' });
    const run = tool('diagnostics_list_recent_events').run;
    const first = (await run({ limit: 2 })) as {
      items: Array<{ lib: string; event: string; payload: unknown }>;
      next: number | null;
      enabled: boolean;
      scope: string;
      buffered: number;
      size: number;
    };
    expect(first.items.map((e) => e.event)).toEqual(['sent', 'run.failed']);
    expect(first).toMatchObject({ next: 2, enabled: true, scope: 'this process', size: 500 });
    expect(first.items[1]?.payload).toEqual({ runId: 'r1', token: '[redacted]' });
    const second = (await run({ limit: 2, page: 2 })) as { items: unknown[]; next: number | null };
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
    const failed = (await run({ event: '/run\\.(failed|cancelled)/' })) as {
      items: Array<{ event: string }>;
    };
    expect(failed.items.map((e) => e.event)).toEqual(['run.failed']);
    const byTrace = (await run({ traceId: 't2', lib: 'mail' })) as { items: unknown[] };
    expect(byTrace.items).toHaveLength(1);
    await app.close();
  });

  it('diagnostics_list_recent_events says when the buffer is off', async () => {
    process.env.NODE_ENV = 'production';
    const app = await boot();
    const result = (await tool('diagnostics_list_recent_events').run({})) as Record<
      string,
      unknown
    >;
    expect(result).toMatchObject({ items: [], next: null, enabled: false });
    expect(String(result.hint)).toMatch(/recent/);
    await app.close();
  });
});
