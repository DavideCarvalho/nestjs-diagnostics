import {
  type DiagnosticEvent,
  emit,
  getChannel,
  resetRegistry,
} from '@dudousxd/nestjs-diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiagnosticsRedisRelay } from '../src/relay.js';
import { FakeHub, FakeRedis } from './fake-redis.js';

const RELAY_CHANNEL = 'aviary:diagnostics:relay';

/** Capture envelopes published to the Redis hub on the relay channel. */
function hubCapture(hub: FakeHub) {
  const seen: Array<{ node: string; env: DiagnosticEvent }> = [];
  const spy = new FakeRedis(hub);
  spy.subscribe(RELAY_CHANNEL);
  spy.on('message', (_ch, raw) => seen.push(JSON.parse(raw)));
  return seen;
}

describe('createDiagnosticsRedisRelay', () => {
  const teardowns: Array<() => void> = [];
  afterEach(() => {
    for (const t of teardowns.splice(0)) t();
    resetRegistry();
  });

  it('forwards a selected local event to Redis', () => {
    const hub = new FakeHub();
    const seen = hubCapture(hub);
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub: new FakeRedis(hub),
        libs: ['resilience'],
        nodeId: 'A',
      }),
    );

    emit('resilience', 'circuit-opened', { key: 'payments' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.node).toBe('A');
    expect(seen[0]?.env.lib).toBe('resilience');
    expect(seen[0]?.env.event).toBe('circuit-opened');
    expect(seen[0]?.env.payload).toEqual({ key: 'payments' });
  });

  it('re-emits a Redis-received event onto the local bus', () => {
    const hub = new FakeHub();
    const sub = new FakeRedis(hub);
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub,
        libs: ['resilience'],
        nodeId: 'B',
      }),
    );
    const local = vi.fn();
    getChannel('resilience', 'circuit-opened').subscribe((m) => local(m));

    // a different node publishes onto the relay channel
    const remote = new FakeRedis(hub);
    const env: DiagnosticEvent = {
      ts: 1,
      lib: 'resilience',
      event: 'circuit-opened',
      payload: { key: 'x' },
    };
    remote.publish(RELAY_CHANNEL, JSON.stringify({ node: 'OTHER', env }));

    expect(local).toHaveBeenCalledTimes(1);
    expect((local.mock.calls[0]?.[0] as DiagnosticEvent).payload).toEqual({ key: 'x' });
  });

  it('suppresses its own echo (node === nodeId)', () => {
    const hub = new FakeHub();
    const sub = new FakeRedis(hub);
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub,
        libs: ['resilience'],
        nodeId: 'A',
      }),
    );
    const local = vi.fn();
    getChannel('resilience', 'circuit-opened').subscribe(() => local());

    const env: DiagnosticEvent = { ts: 1, lib: 'resilience', event: 'circuit-opened', payload: {} };
    new FakeRedis(hub).publish(RELAY_CHANNEL, JSON.stringify({ node: 'A', env }));

    expect(local).not.toHaveBeenCalled();
  });

  it('round-trips between two processes exactly once, with no loop', () => {
    const hub = new FakeHub();
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub: new FakeRedis(hub),
        libs: ['resilience'],
        nodeId: 'A',
      }),
    );
    const bPub = new FakeRedis(hub);
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: bPub,
        sub: new FakeRedis(hub),
        libs: ['resilience'],
        nodeId: 'B',
      }),
    );
    const onB = vi.fn();
    getChannel('resilience', 'circuit-opened').subscribe(() => onB());

    const beforeB = bPub.publishCount;
    emit('resilience', 'circuit-opened', { key: 'p' });

    // B's local subscriber fired exactly once (delivered cross-process)...
    expect(onB).toHaveBeenCalledTimes(1);
    // ...and B did NOT re-forward the re-emitted event back to Redis (loop guard held).
    expect(bPub.publishCount).toBe(beforeB);
  });

  it('honors exact channel selection and dotted event names', () => {
    const hub = new FakeHub();
    const seen = hubCapture(hub);
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub: new FakeRedis(hub),
        channels: [{ lib: 'durable', event: 'run.failed' }],
        nodeId: 'A',
      }),
    );

    emit('durable', 'run.failed', { runId: 'r1' });
    emit('durable', 'run.started', { runId: 'r1' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.env.event).toBe('run.failed');
  });

  it('forwards a future channel of a selected lib (onChannelRegistered)', () => {
    const hub = new FakeHub();
    const seen = hubCapture(hub);
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub: new FakeRedis(hub),
        libs: ['authz'],
        nodeId: 'A',
      }),
    );

    // 'authz:decision' channel first registers at this emit, after the relay started
    emit('authz', 'decision', { allow: true });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.env.event).toBe('decision');
  });

  it('ignores malformed Redis messages without throwing', () => {
    const hub = new FakeHub();
    teardowns.push(
      createDiagnosticsRedisRelay({
        pub: new FakeRedis(hub),
        sub: new FakeRedis(hub),
        all: true,
        nodeId: 'A',
      }),
    );
    const sender = new FakeRedis(hub);
    expect(() => sender.publish(RELAY_CHANNEL, 'not json')).not.toThrow();
    expect(() => sender.publish(RELAY_CHANNEL, JSON.stringify({ node: 'X' }))).not.toThrow();
  });

  it('stops forwarding and receiving after teardown', () => {
    const hub = new FakeHub();
    const seen = hubCapture(hub);
    const teardown = createDiagnosticsRedisRelay({
      pub: new FakeRedis(hub),
      sub: new FakeRedis(hub),
      libs: ['resilience'],
      nodeId: 'A',
    });
    const local = vi.fn();
    getChannel('resilience', 'circuit-opened').subscribe(() => local());

    teardown();
    emit('resilience', 'circuit-opened', { key: 'p' });
    new FakeRedis(hub).publish(
      RELAY_CHANNEL,
      JSON.stringify({
        node: 'OTHER',
        env: { ts: 1, lib: 'resilience', event: 'circuit-opened', payload: {} },
      }),
    );

    expect(seen).toHaveLength(0);
    expect(local).not.toHaveBeenCalled();
  });
});
