import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Isolate the module's wiring (start relay on bootstrap, teardown on shutdown) from the relay's
// behavior (covered by relay.spec.ts) by mocking the relay factory.
const { relayFactory, teardownSpy } = vi.hoisted(() => {
  const teardownSpy = vi.fn();
  return { teardownSpy, relayFactory: vi.fn(() => teardownSpy) };
});
vi.mock('../src/relay.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/relay.js')>();
  return { ...actual, createDiagnosticsRedisRelay: relayFactory };
});

import { DiagnosticsRedisModule } from '../src/diagnostics-redis.module.js';

const fakeClient = {
  publish() {},
  subscribe() {},
  on() {},
  removeListener() {},
  unsubscribe() {},
};

describe('DiagnosticsRedisModule', () => {
  afterEach(() => {
    relayFactory.mockClear();
    teardownSpy.mockClear();
  });

  it('starts the relay on bootstrap with the given options', async () => {
    const opts = { pub: fakeClient, sub: fakeClient, libs: ['durable'] };
    const moduleRef = await Test.createTestingModule({
      imports: [DiagnosticsRedisModule.forRoot(opts)],
    }).compile();
    await moduleRef.init();
    try {
      expect(relayFactory).toHaveBeenCalledTimes(1);
      expect(relayFactory).toHaveBeenCalledWith(opts);
    } finally {
      await moduleRef.close();
    }
  });

  it('tears the relay down on shutdown', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiagnosticsRedisModule.forRoot({ pub: fakeClient, sub: fakeClient, all: true })],
    }).compile();
    await moduleRef.init();
    expect(teardownSpy).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(teardownSpy).toHaveBeenCalledTimes(1);
  });
});
