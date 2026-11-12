import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DiagnosticEvent, emit, publishRelayed, resetRegistry, trace } from '../src/index.js';
import { getChannel } from '../src/index.js';
import {
  DiagnosticsExplorer,
  DiagnosticsModule,
  type DiagnosticsModuleOptions,
  type ListenerDelivery,
  OnDiagnostic,
  type TransportContext,
  type TransportProvider,
  UnknownDiagnosticListenerError,
} from '../src/nestjs/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

@Injectable()
class TrackRun {
  readonly seen: DiagnosticEvent[] = [];
  fail = false;

  @OnDiagnostic('agent', 'run.finished')
  @OnDiagnostic('agent', /^step\./)
  handle(event: DiagnosticEvent) {
    this.seen.push(event);
    if (this.fail) throw new Error('handler failed');
  }
}

@Injectable()
class EveryAgentEvent {
  readonly seen: DiagnosticEvent[] = [];

  @OnDiagnostic('agent')
  async onAny(event: DiagnosticEvent) {
    this.seen.push(event);
  }
}

async function boot(options: DiagnosticsModuleOptions = {}, providers: unknown[] = [TrackRun]) {
  const moduleRef = await Test.createTestingModule({
    imports: [DiagnosticsModule.forRoot(options)],
    providers: providers as never,
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

/** A delivering transport that records what it is handed and exposes its context. */
function fakeDelivering() {
  const delivered: ListenerDelivery[][] = [];
  const state: { ctx?: TransportContext; stopped: boolean } = { stopped: false };
  const provider: TransportProvider = async (ctx) => {
    state.ctx = ctx;
    return {
      deliver: (deliveries) => {
        delivered.push([...deliveries]);
      },
      stop: () => {
        state.stopped = true;
      },
    };
  };
  return { provider, delivered, state };
}

describe('envelope id', () => {
  beforeEach(() => resetRegistry());

  it('emit stamps a fresh uuid on every envelope', () => {
    const seen: DiagnosticEvent[] = [];
    const listener = (m: unknown) => seen.push(m as DiagnosticEvent);
    getChannel('billing', 'paid').subscribe(listener);
    emit('billing', 'paid', {});
    emit('billing', 'paid', {});
    getChannel('billing', 'paid').unsubscribe(listener);
    expect(seen[0]?.id).toMatch(UUID);
    expect(seen[1]?.id).toMatch(UUID);
    expect(seen[0]?.id).not.toBe(seen[1]?.id);
  });

  it('trace stamps an id on every phase envelope', async () => {
    const { default: dc } = await import('node:diagnostics_channel');
    const ids: string[] = [];
    const listener = (m: unknown) => ids.push((m as { id: string }).id);
    dc.channel('aviary:authz:decision:start').subscribe(listener);
    dc.channel('aviary:authz:decision:end').subscribe(listener);
    trace('authz', 'decision', () => true);
    dc.channel('aviary:authz:decision:start').unsubscribe(listener);
    dc.channel('aviary:authz:decision:end').unsubscribe(listener);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});

describe('listeners', () => {
  beforeEach(() => resetRegistry());

  it('gets a stable <Class>#<method> id; stacked decorators keep one id', async () => {
    const app = await boot({}, [TrackRun, EveryAgentEvent]);
    const ids = app
      .get(DiagnosticsExplorer)
      .registeredListeners()
      .map((l) => l.id);
    expect(ids.sort()).toEqual(['EveryAgentEvent#onAny', 'TrackRun#handle']);
    await app.close();
  });

  it('matches exact names, patterns and whole libs', async () => {
    const app = await boot({}, [TrackRun, EveryAgentEvent]);
    emit('agent', 'run.finished', { n: 1 });
    emit('agent', 'step.done', { n: 2 });
    emit('agent', 'other', { n: 3 });
    expect(app.get(TrackRun).seen.map((e) => e.event)).toEqual(['run.finished', 'step.done']);
    expect(app.get(EveryAgentEvent).seen.map((e) => e.event)).toEqual([
      'run.finished',
      'step.done',
      'other',
    ]);
    await app.close();
  });

  it('refuses two classes with the same name', async () => {
    const make = () => {
      @Injectable()
      class Dup {
        @OnDiagnostic('agent', 'x')
        h() {}
      }
      return Dup;
    };
    const A = make();
    const B = make();
    await expect(boot({}, [A, { provide: 'b', useClass: B }])).rejects.toThrow(
      /two listeners share the id "Dup#h"/,
    );
  });

  it('the invoker runs a listener and rejects with its error', async () => {
    const app = await boot();
    const explorer = app.get(DiagnosticsExplorer);
    const env = { id: 'e1', ts: 1, lib: 'agent', event: 'run.finished', payload: {} };
    await explorer.invoke('TrackRun#handle', env);
    expect(app.get(TrackRun).seen).toEqual([env]);
    app.get(TrackRun).fail = true;
    await expect(explorer.invoke('TrackRun#handle', env)).rejects.toThrow('handler failed');
    await expect(explorer.invoke('Nope#x', env)).rejects.toBeInstanceOf(
      UnknownDiagnosticListenerError,
    );
    await app.close();
  });
});

describe('role', () => {
  beforeEach(() => resetRegistry());

  it.each(['api', 'worker'] as const)(
    'refuses role %s without a default transport',
    async (role) => {
      await expect(boot({ role })).rejects.toThrow(/no `default` transport is selected/);
    },
  );

  it('refuses an unknown role', async () => {
    await expect(boot({ role: 'web' as never })).rejects.toThrow(/role must be/);
  });

  it('refuses a default that names no transport', async () => {
    await expect(boot({ default: 'queue', transports: {} })).rejects.toThrow(
      /transports.queue is not defined/,
    );
  });

  it("'api' with a broadcasting transport never runs listeners here", async () => {
    const started: TransportContext[] = [];
    const broadcast: TransportProvider = async (ctx) => {
      started.push(ctx);
      return {};
    };
    const app = await boot({ role: 'api', default: 'redis', transports: { redis: broadcast } });
    emit('agent', 'run.finished', {});
    expect(app.get(TrackRun).seen).toHaveLength(0);
    expect(started[0]?.role).toBe('api');
    await app.close();
  });

  it("'api' with a delivering transport hands work over and runs nothing", async () => {
    const fake = fakeDelivering();
    const app = await boot({ role: 'api', default: 'queue', transports: { queue: fake.provider } });
    emit('agent', 'run.finished', {});
    await nextTurn();
    expect(fake.delivered.flat()).toHaveLength(1);
    expect(app.get(TrackRun).seen).toHaveLength(0);
    await app.close();
  });
});

describe('delivering transport', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => vi.restoreAllMocks());

  it('hands one delivery per (listener, event) to the transport, batched per turn', async () => {
    const fake = fakeDelivering();
    const app = await boot(
      { default: 'queue', nodeId: 'web-1', transports: { queue: fake.provider } },
      [TrackRun, EveryAgentEvent],
    );
    expect(fake.state.ctx?.listenerIds).toEqual(['TrackRun#handle', 'EveryAgentEvent#onAny']);
    expect(fake.state.ctx?.listenerLibs).toEqual(['agent']);
    expect(fake.state.ctx?.nodeId).toBe('web-1');

    emit('agent', 'run.finished', { run: 1 });
    emit('agent', 'other', { run: 2 });
    // Not run in-process, and not handed over on the emitter's stack.
    expect(app.get(TrackRun).seen).toHaveLength(0);
    expect(fake.delivered).toHaveLength(0);
    await nextTurn();

    expect(fake.delivered).toHaveLength(1);
    const batch = fake.delivered[0] ?? [];
    expect(batch.map((d) => d.listenerId)).toEqual([
      'TrackRun#handle',
      'EveryAgentEvent#onAny',
      'EveryAgentEvent#onAny',
    ]);
    expect(batch[0]?.envelope.id).toMatch(UUID);
    expect(batch[0]?.envelope.id).toBe(batch[1]?.envelope.id);
    expect(batch[2]?.envelope.payload).toEqual({ run: 2 });
    await app.close();
  });

  it('never delivers a relayed copy (emit at origin only)', async () => {
    const fake = fakeDelivering();
    const app = await boot({ default: 'queue', transports: { queue: fake.provider } });
    const env = { id: 'remote', ts: 1, lib: 'agent', event: 'run.finished', payload: {} };
    publishRelayed(env, () => getChannel('agent', 'run.finished').publish(env));
    await nextTurn();
    expect(fake.delivered).toHaveLength(0);
    await app.close();
  });

  it('the context invoker propagates handler errors so the transport can retry', async () => {
    const fake = fakeDelivering();
    const app = await boot({ default: 'queue', transports: { queue: fake.provider } });
    app.get(TrackRun).fail = true;
    const env = { id: 'e', ts: 1, lib: 'agent', event: 'run.finished', payload: {} };
    await expect(fake.state.ctx?.invoke('TrackRun#handle', env)).rejects.toThrow('handler failed');
    await app.close();
  });

  it('hands queued deliveries over, then stops the transport on shutdown', async () => {
    const fake = fakeDelivering();
    const app = await boot({ default: 'queue', transports: { queue: fake.provider } });
    emit('agent', 'run.finished', {});
    await app.close();
    expect(fake.delivered.flat()).toHaveLength(1);
    expect(fake.state.stopped).toBe(true);
  });

  it('a failing deliver is logged, never thrown into emit', async () => {
    const failing: TransportProvider = async () => ({
      deliver: async () => {
        throw new Error('queue down');
      },
    });
    const app = await boot({ default: 'queue', transports: { queue: failing } });
    expect(() => emit('agent', 'run.finished', {})).not.toThrow();
    await nextTurn();
    await nextTurn();
    await app.close();
  });

  it('forRootAsync builds the options from DI', async () => {
    const fake = fakeDelivering();
    const moduleRef = await Test.createTestingModule({
      imports: [
        DiagnosticsModule.forRootAsync({
          useFactory: () => ({ default: 'queue', transports: { queue: fake.provider } }),
        }),
      ],
      providers: [TrackRun],
    }).compile();
    await moduleRef.init();
    expect(fake.state.ctx?.listenerIds).toEqual(['TrackRun#handle']);
    await moduleRef.close();
  });
});
