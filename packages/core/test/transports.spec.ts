import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DiagnosticEvent, emit, getChannel, resetRegistry } from '../src/index.js';
import type {
  DeliveryTransportContext,
  DurableDiagnosticsDeliveryModule,
  TransportContext,
} from '../src/nestjs/index.js';
import { transports } from '../src/nestjs/index.js';
import type {
  BullmqModuleLike,
  DiagnosticsListenerJobData,
} from '../src/nestjs/queue-transport.js';
import {
  BULLMQ_NOT_INSTALLED,
  DURABLE_NOT_CONFIGURED,
  DURABLE_NOT_INSTALLED,
  DURABLE_OUTDATED,
  setTransportModuleLoader,
} from '../src/nestjs/transports.js';
import { FakeHub, FakeRedis } from './fake-redis.js';

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const moduleRef = {} as ModuleRef;

function context(overrides: Partial<TransportContext> = {}): TransportContext {
  return {
    moduleRef,
    role: 'all',
    nodeId: 'node-1',
    listenerLibs: ['agent'],
    listenerIds: ['TrackRun#handle'],
    invoke: vi.fn(async () => {}),
    logger: new Logger('test'),
    ...overrides,
  };
}

const envelope = { id: 'evt-1', ts: 1, lib: 'agent', event: 'run.finished', payload: { a: 1 } };

afterEach(() => {
  setTransportModuleLoader('durable', null);
  setTransportModuleLoader('bullmq', null);
  resetRegistry();
});

describe('transports.durable()', () => {
  it('costs nothing until started', () => {
    const load = vi.fn();
    setTransportModuleLoader('durable', load);
    transports.durable({ retries: 5 });
    expect(load).not.toHaveBeenCalled();
  });

  it('fails with a clear message when the durable package is not installed', async () => {
    // What Node throws for a missing package (the two-process spec checks the real import).
    setTransportModuleLoader('durable', async () => {
      throw Object.assign(
        new Error(
          "Cannot find package '@dudousxd/nestjs-durable-diagnostics' imported from /app/x.js",
        ),
        { code: 'ERR_MODULE_NOT_FOUND' },
      );
    });
    await expect(transports.durable()(context())).rejects.toThrow(DURABLE_NOT_INSTALLED);
  });

  it('fails when the installed durable package does not export the delivery contract', async () => {
    setTransportModuleLoader('durable', async () => ({}));
    await expect(transports.durable()(context())).rejects.toThrow(DURABLE_OUTDATED);
    setTransportModuleLoader('durable', async () => {
      throw Object.assign(
        new Error(
          'Package subpath ./delivery is not defined by "exports" in @dudousxd/nestjs-durable-diagnostics',
        ),
        { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
      );
    });
    await expect(transports.durable()(context())).rejects.toThrow(DURABLE_OUTDATED);
  });

  it('fails when durable is installed but not configured', async () => {
    const mod: DurableDiagnosticsDeliveryModule = {
      isConfigured: () => false,
      createDeliveryTransport: vi.fn(),
    };
    setTransportModuleLoader('durable', async () => mod);
    await expect(transports.durable()(context())).rejects.toThrow(DURABLE_NOT_CONFIGURED);
    expect(mod.createDeliveryTransport).not.toHaveBeenCalled();
  });

  it('creates the durable delivery transport with the context and options', async () => {
    const seen: Array<[DeliveryTransportContext, unknown]> = [];
    const deliver = vi.fn();
    const mod: DurableDiagnosticsDeliveryModule = {
      isConfigured: (ref) => ref === moduleRef,
      createDeliveryTransport: (ctx, config) => {
        seen.push([ctx, config]);
        return { deliver };
      },
    };
    setTransportModuleLoader('durable', async () => mod);
    const ctx = context({ role: 'api' });
    const handle = await transports.durable({ retries: 5, backoff: 'exp' })(ctx);
    expect(handle.deliver).toBe(deliver);
    expect(seen[0]?.[0]).toEqual({
      moduleRef,
      nodeId: 'node-1',
      role: 'api',
      invoke: ctx.invoke,
      listenerIds: ['TrackRun#handle'],
    });
    expect(seen[0]?.[1]).toEqual({ retries: 5, backoff: 'exp' });
  });
});

/** An in-memory stand-in for the `bullmq` module: a queue whose jobs run on the first worker. */
function fakeBullmq() {
  const added: Array<{ name: string; data: DiagnosticsListenerJobData; opts: { jobId: string } }> =
    [];
  const workers: Array<{
    name: string;
    processor: (job: { data: DiagnosticsListenerJobData }) => Promise<void>;
    opts: Record<string, unknown>;
    closed: boolean;
  }> = [];
  const queues: Array<{ name: string; opts: Record<string, unknown>; closed: boolean }> = [];
  const mod: BullmqModuleLike = {
    Queue: class {
      private readonly record: (typeof queues)[number];
      constructor(name: string, opts: Record<string, unknown>) {
        this.record = { name, opts, closed: false };
        queues.push(this.record);
      }
      async addBulk(jobs: typeof added) {
        added.push(...jobs);
      }
      on() {}
      async close() {
        this.record.closed = true;
      }
    } as unknown as BullmqModuleLike['Queue'],
    Worker: class {
      private readonly record: (typeof workers)[number];
      constructor(
        name: string,
        processor: (typeof workers)[number]['processor'],
        opts: Record<string, unknown>,
      ) {
        this.record = { name, processor, opts, closed: false };
        workers.push(this.record);
      }
      on() {}
      async close() {
        this.record.closed = true;
      }
    } as unknown as BullmqModuleLike['Worker'],
  };
  return { mod, added, workers, queues };
}

describe('transports.queue()', () => {
  it('fails with a clear message when bullmq is not installed', async () => {
    setTransportModuleLoader('bullmq', async () => {
      throw Object.assign(new Error("Cannot find package 'bullmq' imported from x"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });
    await expect(transports.queue({ connection: {} })(context())).rejects.toThrow(
      BULLMQ_NOT_INSTALLED,
    );
  });

  it('adds one job per (listener, event), idempotent by event id, with retries', async () => {
    const fake = fakeBullmq();
    setTransportModuleLoader('bullmq', async () => fake.mod);
    const connection = { host: 'redis' };
    const handle = await transports.queue({
      connection,
      queue: 'diag',
      prefix: 'app',
      retries: 5,
      backoff: { type: 'fixed', delay: 10 },
    })(context());
    await handle.deliver?.([
      { listenerId: 'TrackRun#handle', envelope },
      { listenerId: 'Audit#record', envelope },
    ]);
    expect(fake.queues[0]).toMatchObject({ name: 'diag', opts: { connection, prefix: 'app' } });
    expect(fake.added.map((j) => j.opts.jobId)).toEqual([
      'diag.evt-1.TrackRun#handle',
      'diag.evt-1.Audit#record',
    ]);
    expect(fake.added[0]).toMatchObject({
      data: { listenerId: 'TrackRun#handle', envelope },
      opts: { attempts: 6, backoff: { type: 'fixed', delay: 10 } },
    });
  });

  it('runs a worker that invokes the listener and lets handler errors fail the job', async () => {
    const fake = fakeBullmq();
    setTransportModuleLoader('bullmq', async () => fake.mod);
    const invoke = vi.fn(async () => {
      throw new Error('handler failed');
    });
    const handle = await transports.queue({ connection: {} })(context({ invoke }));
    expect(fake.workers).toHaveLength(1);
    expect(fake.workers[0]?.name).toBe('aviary-diagnostics');
    await expect(
      fake.workers[0]?.processor({ data: { listenerId: 'TrackRun#handle', envelope } }),
    ).rejects.toThrow('handler failed');
    expect(invoke).toHaveBeenCalledWith('TrackRun#handle', envelope);
    await handle.stop?.();
    expect(fake.workers[0]?.closed).toBe(true);
    expect(fake.queues[0]?.closed).toBe(true);
  });

  it("starts no worker on role 'api'", async () => {
    const fake = fakeBullmq();
    setTransportModuleLoader('bullmq', async () => fake.mod);
    await transports.queue({ connection: {} })(context({ role: 'api' }));
    expect(fake.workers).toHaveLength(0);
    expect(fake.queues).toHaveLength(1);
  });
});

describe('transports.redis()', () => {
  const RELAY = 'aviary:diagnostics:relay';

  function capture(hub: FakeHub) {
    const seen: Array<{ node: string; env: DiagnosticEvent }> = [];
    const spy = new FakeRedis(hub);
    spy.subscribe(RELAY);
    spy.on('message', (_ch, raw) => seen.push(JSON.parse(raw)));
    return seen;
  }

  it('forwards the libs that have listeners, with the envelope id', async () => {
    const hub = new FakeHub();
    const seen = capture(hub);
    const handle = await transports.redis({ pub: new FakeRedis(hub), sub: new FakeRedis(hub) })(
      context(),
    );
    const local: DiagnosticEvent[] = [];
    const listener = (m: unknown) => local.push(m as DiagnosticEvent);
    getChannel('agent', 'run.finished').subscribe(listener);
    emit('agent', 'run.finished', {});
    await nextTurn();
    getChannel('agent', 'run.finished').unsubscribe(listener);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.env.id).toBe(local[0]?.id);
    await handle.stop?.();
  });

  it("publishes but never subscribes on role 'api'", async () => {
    const hub = new FakeHub();
    const sub = new FakeRedis(hub);
    const subscribe = vi.spyOn(sub, 'subscribe');
    const handle = await transports.redis({ pub: new FakeRedis(hub), sub })(
      context({ role: 'api' }),
    );
    expect(subscribe).not.toHaveBeenCalled();
    await handle.stop?.();
  });

  it('needs a sub connection unless the role is api', async () => {
    const hub = new FakeHub();
    await expect(transports.redis({ pub: new FakeRedis(hub) })(context())).rejects.toThrow(
      /needs a `sub` connection/,
    );
  });
});
