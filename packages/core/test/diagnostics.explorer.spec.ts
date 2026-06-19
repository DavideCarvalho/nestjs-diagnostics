import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emit, resetRegistry } from '../src/index.js';
import type { DiagnosticEvent } from '../src/index.js';
import { DiagnosticsModule } from '../src/nestjs/diagnostics.module.js';
import { OnDiagnostic } from '../src/nestjs/on-diagnostic.decorator.js';

@Injectable()
class Reactions {
  readonly exact: DiagnosticEvent[] = [];
  readonly lib: DiagnosticEvent[] = [];

  @OnDiagnostic('resilience', 'circuit-opened')
  onOpen(e: DiagnosticEvent) {
    this.exact.push(e);
  }

  @OnDiagnostic('resilience')
  onAny(e: DiagnosticEvent) {
    this.lib.push(e);
  }
}

async function boot(providers: unknown[] = [Reactions]) {
  const moduleRef = await Test.createTestingModule({
    imports: [DiagnosticsModule.forRoot()],
    providers: providers as never,
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

describe('DiagnosticsExplorer', () => {
  beforeEach(() => resetRegistry());

  it('invokes the exact handler with the full envelope; DI works', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    emit('resilience', 'circuit-opened', { key: 'payments' });
    expect(r.exact).toHaveLength(1);
    expect(r.exact[0]).toMatchObject({
      lib: 'resilience',
      event: 'circuit-opened',
      payload: { key: 'payments' },
    });
    await app.close();
  });

  it('the exact binding does not fire for a different event of the same lib', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    emit('resilience', 'failover', { target: 'vonage' });
    expect(r.exact).toHaveLength(0);
    expect(r.lib).toHaveLength(1); // the wildcard did fire
    await app.close();
  });

  it('the lib wildcard fires for a channel first registered AFTER bootstrap', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    emit('resilience', 'timeout', { key: 'api' }); // channel registered now, via onChannelRegistered
    expect(r.lib).toHaveLength(1);
    expect(r.lib[0]).toMatchObject({ event: 'timeout' });
    await app.close();
  });

  it('the lib wildcard fires for a channel already registered BEFORE bootstrap', async () => {
    emit('resilience', 'retry', { n: 1 }); // registers aviary:resilience:retry, no subscriber yet
    const app = await boot();
    const r = app.get(Reactions);
    emit('resilience', 'retry', { n: 2 });
    expect(r.lib).toHaveLength(1); // picked up by the registeredChannels() loop at bootstrap
    await app.close();
  });

  it('does not fire for another library', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    emit('authz', 'decision', { allow: true });
    expect(r.exact).toHaveLength(0);
    expect(r.lib).toHaveLength(0);
    await app.close();
  });

  it('a throwing handler never breaks the emitter', async () => {
    @Injectable()
    class Boom {
      @OnDiagnostic('billing', 'charged')
      h() {
        throw new Error('boom');
      }
    }
    const app = await boot([Boom]);
    expect(() => emit('billing', 'charged', {})).not.toThrow();
    await app.close();
  });

  it('an async rejecting handler is swallowed (no throw into emit)', async () => {
    @Injectable()
    class AsyncBoom {
      @OnDiagnostic('billing', 'charged')
      async h() {
        throw new Error('async boom');
      }
    }
    const app = await boot([AsyncBoom]);
    expect(() => emit('billing', 'charged', {})).not.toThrow();
    await new Promise((r) => setImmediate(r)); // let the rejected promise settle
    await app.close();
  });

  it('stops invoking handlers after the app closes', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    await app.close();
    emit('resilience', 'circuit-opened', { key: 'x' });
    expect(r.exact).toHaveLength(0);
    expect(r.lib).toHaveLength(0);
  });
});
