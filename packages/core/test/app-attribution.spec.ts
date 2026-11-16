import diagnostics_channel from 'node:diagnostics_channel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DiagnosticEvent,
  channelName,
  emit,
  getChannel,
  recentEvents,
  resetRegistry,
  startRecentEvents,
  stopRecentEvents,
} from '../src/index.js';
import { createDiagnosticsRedisRelay } from '../src/redis-relay.js';
import { FakeHub, FakeRedis } from './fake-redis.js';

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function capture(lib: string, event: string) {
  const events: DiagnosticEvent[] = [];
  const channel = diagnostics_channel.channel(channelName(lib, event));
  const onMessage = (msg: unknown) => events.push(msg as DiagnosticEvent);
  channel.subscribe(onMessage);
  return { events, stop: () => channel.unsubscribe(onMessage) };
}

describe('emit app attribution', () => {
  const teardowns: Array<() => void> = [];
  afterEach(() => {
    for (const t of teardowns.splice(0)) t();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetRegistry();
  });

  it('stamps a valid app on the envelope', () => {
    const cap = capture('durable', 'run.started');
    teardowns.push(cap.stop);

    emit('durable', 'run.started', { runId: 'r1' }, { app: 'billing-api' });
    emit('durable', 'run.started', { runId: 'r2' }, { app: 'A.b_c-1' });
    emit('durable', 'run.started', { runId: 'r3' }, { app: 'x'.repeat(64) });

    expect(cap.events.map((e) => e.app)).toEqual(['billing-api', 'A.b_c-1', 'x'.repeat(64)]);
  });

  it('leaves the envelope without an app key when none is given', () => {
    const cap = capture('durable', 'run.started');
    teardowns.push(cap.stop);

    emit('durable', 'run.started', { runId: 'r1' });
    emit('durable', 'run.started', { runId: 'r2' }, { traceId: 't' });

    expect(cap.events).toHaveLength(2);
    for (const env of cap.events) expect('app' in env).toBe(false);
  });

  it('drops an invalid app with a warning, still publishes, and never throws', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const cap = capture('durable', 'run.started');
    teardowns.push(cap.stop);

    const invalid = ['', 'has space', 'tenant:a', 'x'.repeat(65), 'ção', 42 as unknown as string];
    for (const app of invalid) {
      expect(() => emit('durable', 'run.started', {}, { app })).not.toThrow();
    }

    expect(cap.events).toHaveLength(invalid.length);
    for (const env of cap.events) expect('app' in env).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain('[A-Za-z0-9_.-]{1,64}');
  });

  it('warns once per invalid value', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const cap = capture('durable', 'run.started');
    teardowns.push(cap.stop);

    for (let i = 0; i < 5; i++) emit('durable', 'run.started', {}, { app: 'once only' });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const cap = capture('durable', 'run.started');
    teardowns.push(cap.stop);

    emit('durable', 'run.started', {}, { app: 'prod invalid' });

    expect(cap.events).toHaveLength(1);
    expect('app' in (cap.events[0] as object)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a throwing warning listener does not break emit', () => {
    vi.spyOn(process, 'emitWarning').mockImplementation(() => {
      throw new Error('boom');
    });
    const cap = capture('durable', 'run.started');
    teardowns.push(cap.stop);

    expect(() => emit('durable', 'run.started', {}, { app: 'throws here' })).not.toThrow();
    expect(cap.events).toHaveLength(1);
  });

  it('the Redis relay carries app to the other process', async () => {
    const hub = new FakeHub();
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub: new FakeRedis(hub),
        libs: ['durable'],
        nodeId: 'A',
      }),
    );
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub: new FakeRedis(hub),
        libs: [],
        nodeId: 'B',
      }),
    );
    const received: DiagnosticEvent[] = [];
    const onMessage = (m: unknown) => received.push(m as DiagnosticEvent);
    getChannel('durable', 'run.failed').subscribe(onMessage);
    teardowns.push(() => getChannel('durable', 'run.failed').unsubscribe(onMessage));

    emit('durable', 'run.failed', { runId: 'r1' }, { app: 'tenant-a' });
    await nextTurn();

    // the local copy, then node B's relayed copy (a different object that went through JSON)
    expect(received).toHaveLength(2);
    expect(received[0]).not.toBe(received[1]);
    expect(received.map((e) => e.app)).toEqual(['tenant-a', 'tenant-a']);
    expect(received[1]?.id).toBe(received[0]?.id);
  });

  it('the recent-events buffer keeps app', () => {
    startRecentEvents(10);
    teardowns.push(() => stopRecentEvents());

    emit('durable', 'run.failed', { runId: 'r1' }, { app: 'tenant-a' });
    emit('durable', 'run.failed', { runId: 'r2' });

    const [newest, oldest] = recentEvents();
    expect(oldest?.app).toBe('tenant-a');
    expect(newest && 'app' in newest).toBe(false);
  });
});
