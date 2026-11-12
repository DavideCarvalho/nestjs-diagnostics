import diagnostics_channel from 'node:diagnostics_channel';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NESTJS_RESILIENCE_CHANNELS,
  RECENT_PAYLOAD_BYTES,
  RecentEventsBuffer,
  boundPayload,
  emit,
  getChannel,
  recentEvents,
  recentEventsBuffer,
  resetRegistry,
  startRecentEvents,
  stopRecentEvents,
  trace,
} from '../src/index.js';
import {
  DiagnosticsModule,
  DiagnosticsRecentEvents,
  resolveRecentSize,
} from '../src/nestjs/index.js';

describe('RecentEventsBuffer', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => stopRecentEvents());

  it('keeps emit() events newest first, from channels registered before and after start', () => {
    emit('billing', 'early', { n: 0 });
    const buffer = startRecentEvents(10);
    emit('billing', 'early', { n: 1 });
    emit('billing', 'later', { n: 2 }, { traceId: 't-1', durationMs: 5 });
    const items = recentEvents();
    expect(items.map((e) => e.payload)).toEqual([{ n: 2 }, { n: 1 }]);
    expect(items[0]).toMatchObject({
      lib: 'billing',
      event: 'later',
      traceId: 't-1',
      durationMs: 5,
    });
    expect(typeof items[0]?.id).toBe('string');
    expect(buffer.count).toBe(2);
  });

  it('is a fixed-size ring: the oldest events fall out', () => {
    startRecentEvents(3);
    for (let n = 0; n < 5; n++) emit('ring', 'tick', { n });
    expect(recentEvents({ limit: 10 }).map((e) => (e.payload as { n: number }).n)).toEqual([
      4, 3, 2,
    ]);
    expect(recentEventsBuffer()?.count).toBe(3);
  });

  it('filters by lib, exact event, /regex/ string, RegExp and traceId, and pages with offset', () => {
    startRecentEvents(50);
    emit('durable', 'run.started', {}, { traceId: 'a' });
    emit('durable', 'run.failed', {}, { traceId: 'b' });
    emit('durable', 'run.cancelled', {}, { traceId: 'a' });
    emit('mail', 'sent', {}, { traceId: 'a' });
    expect(recentEvents({ lib: 'durable' })).toHaveLength(3);
    expect(recentEvents({ event: 'sent' }).map((e) => e.lib)).toEqual(['mail']);
    expect(recentEvents({ event: '/run\\.(failed|cancelled)/' }).map((e) => e.event)).toEqual([
      'run.cancelled',
      'run.failed',
    ]);
    expect(recentEvents({ event: /STARTED/gi }).map((e) => e.event)).toEqual(['run.started']);
    expect(recentEvents({ event: /STARTED/gi }).map((e) => e.event)).toEqual(['run.started']);
    expect(recentEvents({ traceId: 'a' })).toHaveLength(3);
    expect(recentEvents({ lib: 'durable', limit: 1, offset: 1 }).map((e) => e.event)).toEqual([
      'run.failed',
    ]);
    expect(() => recentEvents({ event: '/(/' })).toThrow(/invalid event pattern/);
  });

  it('records trace() span phases with spanId, result and error', async () => {
    startRecentEvents(50);
    trace('jobs', 'run', () => 'ok', { job: 1 });
    await expect(
      trace(
        'jobs',
        'fail',
        async () => {
          throw new TypeError('boom');
        },
        { job: 2 },
      ),
    ).rejects.toThrow('boom');
    const ok = recentEvents({ event: 'run', limit: 10 });
    expect(ok.map((e) => e.phase)).toEqual(['end', 'start']);
    expect(ok[0]?.result).toBe('ok');
    expect(ok[0]?.spanId).toBe(ok[1]?.spanId);
    expect(ok[1]?.payload).toEqual({ job: 1 });
    const failed = recentEvents({ event: 'fail', limit: 10 });
    expect(failed.some((e) => e.error?.message === 'boom' && e.error.name === 'TypeError')).toBe(
      true,
    );
    expect(failed.every((e) => e.phase !== 'asyncStart')).toBe(true);
  });

  it('records first-party nestjs:* events with source "nestjs"', () => {
    startRecentEvents(10);
    diagnostics_channel
      .channel(NESTJS_RESILIENCE_CHANNELS.retry)
      .publish({ policy: 'p', attempt: 2 });
    expect(recentEvents()[0]).toMatchObject({
      lib: 'resilience',
      event: 'retry',
      source: 'nestjs',
      payload: { policy: 'p', attempt: 2 },
    });
  });

  it('stop() unsubscribes everything so emit is free again; the events stay readable', () => {
    const buffer = startRecentEvents(10);
    emit('quiet', 'x', {});
    expect(getChannel('quiet', 'x').hasSubscribers).toBe(true);
    expect(diagnostics_channel.channel(NESTJS_RESILIENCE_CHANNELS.retry).hasSubscribers).toBe(true);
    buffer.stop();
    expect(getChannel('quiet', 'x').hasSubscribers).toBe(false);
    expect(diagnostics_channel.channel('aviary:quiet:x:end').hasSubscribers).toBe(false);
    expect(diagnostics_channel.channel(NESTJS_RESILIENCE_CHANNELS.retry).hasSubscribers).toBe(
      false,
    );
    expect(buffer.list()).toHaveLength(1);
    stopRecentEvents();
    expect(recentEventsBuffer()).toBeNull();
    expect(recentEvents()).toEqual([]);
  });

  it('starting again with the same size keeps the buffer; another size replaces it', () => {
    const a = startRecentEvents(10);
    expect(startRecentEvents(10)).toBe(a);
    const b = startRecentEvents(20);
    expect(b).not.toBe(a);
    expect(a.started).toBe(false);
    expect(b.size).toBe(20);
  });

  it('rejects a size that is not a positive integer', () => {
    expect(() => new RecentEventsBuffer(0)).toThrow(/positive integer/);
    expect(() => new RecentEventsBuffer(1.5)).toThrow(/positive integer/);
  });

  it('push never throws on junk', () => {
    const buffer = new RecentEventsBuffer(2);
    buffer.push(null as never);
    buffer.push({ nope: true } as never);
    expect(buffer.count).toBe(0);
  });
});

describe('boundPayload', () => {
  it('redacts secret-looking keys at any depth', () => {
    expect(
      boundPayload({
        user: { id: 1, password: 'x', apiKey: 'k', api_key: 'k' },
        headers: [{ Authorization: 'Bearer x', cookie: 'c' }],
        accessToken: 't',
        clientSecret: 's',
        privateKey: 'p',
      }),
    ).toEqual({
      user: { id: 1, password: '[redacted]', apiKey: '[redacted]', api_key: '[redacted]' },
      headers: [{ Authorization: '[redacted]', cookie: '[redacted]' }],
      accessToken: '[redacted]',
      clientSecret: '[redacted]',
      privateKey: '[redacted]',
    });
  });

  it('cuts big payloads to a preview', () => {
    const big = boundPayload({ blob: 'x'.repeat(RECENT_PAYLOAD_BYTES * 2) }) as {
      truncated: boolean;
      bytes: number;
      preview: string;
    };
    expect(big.truncated).toBe(true);
    expect(big.bytes).toBeGreaterThan(RECENT_PAYLOAD_BYTES);
    expect(Buffer.byteLength(big.preview)).toBeLessThanOrEqual(RECENT_PAYLOAD_BYTES + 3);
  });

  it('survives cycles, bigints, dates, maps, sets and errors', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(boundPayload(cyclic)).toEqual({ a: 1, self: '[circular]' });
    expect(boundPayload({ n: 10n })).toEqual({ n: '10' });
    expect(boundPayload({ at: new Date(0) })).toEqual({ at: '1970-01-01T00:00:00.000Z' });
    expect(
      boundPayload(
        new Map([
          ['token', 'x'],
          ['ok', 1],
        ]),
      ),
    ).toEqual({ token: '[redacted]', ok: 1 });
    expect(boundPayload(new Set([1, 2]))).toEqual([1, 2]);
    expect(boundPayload({ err: new RangeError('bad') })).toEqual({
      err: { name: 'RangeError', message: 'bad' },
    });
    expect(boundPayload(undefined)).toBeUndefined();
  });
});

describe('DiagnosticsModule recent option', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => resetRegistry());
  afterEach(() => {
    process.env.NODE_ENV = env;
    stopRecentEvents();
  });

  it('resolves the default from NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    expect(resolveRecentSize(undefined)).toBe(500);
    process.env.NODE_ENV = 'production';
    expect(resolveRecentSize(undefined)).toBeNull();
    expect(resolveRecentSize(true)).toBe(500);
    expect(resolveRecentSize({ size: 50 })).toBe(50);
    expect(resolveRecentSize({})).toBe(500);
    process.env.NODE_ENV = 'development';
    expect(resolveRecentSize(false)).toBeNull();
  });

  async function boot(options: Parameters<typeof DiagnosticsModule.forRoot>[0] = {}) {
    const moduleRef = await Test.createTestingModule({
      imports: [DiagnosticsModule.forRoot(options)],
    }).compile();
    await moduleRef.init();
    return moduleRef;
  }

  it('is on by default outside production, read through the provider, stopped on close', async () => {
    process.env.NODE_ENV = 'development';
    const app = await boot();
    const recent = app.get(DiagnosticsRecentEvents);
    expect(recent.enabled).toBe(true);
    emit('app', 'hello', { who: 'dev' });
    expect(recent.list()).toMatchObject([{ lib: 'app', event: 'hello', payload: { who: 'dev' } }]);
    recent.clear();
    expect(recent.list()).toEqual([]);
    await app.close();
    expect(recentEventsBuffer()).toBeNull();
  });

  it('is off by default in production, so emit keeps its fast path', async () => {
    process.env.NODE_ENV = 'production';
    const app = await boot();
    expect(app.get(DiagnosticsRecentEvents).enabled).toBe(false);
    emit('app', 'hello', {});
    expect(getChannel('app', 'hello').hasSubscribers).toBe(false);
    expect(app.get(DiagnosticsRecentEvents).list()).toEqual([]);
    await app.close();
  });

  it('runs in production with recent: { size }', async () => {
    process.env.NODE_ENV = 'production';
    const app = await boot({ recent: { size: 2 } });
    for (let n = 0; n < 3; n++) emit('app', 'tick', { n });
    expect(app.get(DiagnosticsRecentEvents).list()).toHaveLength(2);
    expect(recentEventsBuffer()?.size).toBe(2);
    await app.close();
  });

  it('recent: false keeps it off outside production', async () => {
    process.env.NODE_ENV = 'development';
    const app = await boot({ recent: false });
    expect(app.get(DiagnosticsRecentEvents).enabled).toBe(false);
    await app.close();
  });

  it('fails the boot on a bad size', async () => {
    await expect(boot({ recent: { size: 0 } })).rejects.toThrow(/positive integer/);
  });
});
