# `@dudousxd/nestjs-diagnostics-redis` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@dudousxd/nestjs-diagnostics-redis` — a consumer-side relay that forwards selected local `aviary:<lib>:<event>` diagnostics channels onto Redis pub/sub and re-emits Redis-received events back onto the local bus, so `@OnDiagnostic` handlers fire across processes.

**Architecture:** A single relay object runs a forwarder (local channels → Redis) and a receiver (Redis → local re-emit), with two loop-prevention guards: nodeId echo suppression + a `reEmitting` WeakSet. Coded against a minimal `RedisLike` interface (ioredis satisfies it). A Nest module starts/stops the relay on the app lifecycle.

**Tech Stack:** TypeScript, `tsc` ESM-only (NodeNext), vitest (per-package config, swc decorators), pnpm workspace. Core stays untouched (in-process). Peers: `ioredis ^5`; optional: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`. Dependency: `@dudousxd/nestjs-diagnostics` (`workspace:^`).

**Spec:** `docs/superpowers/specs/2026-06-19-diagnostics-redis-transport-design.md`

## Global Constraints

- Package name `@dudousxd/nestjs-diagnostics-redis`, directory `packages/redis`.
- **Mirror `packages/telescope`** for `package.json` (ESM-only: `type:module`, `main/types/exports` → dist, `build: tsc -p tsconfig.json`), `tsconfig.json`, and `packages/core/vitest.config.ts` for `vitest.config.ts` (swc decorators, `include: ['test/**/*.{spec,test}.ts']`, `setupFiles: ['./test/setup.ts']`). Tests live in `test/` (excluded from build).
- Wire format on Redis: JSON `{ "node": "<nodeId>", "env": <DiagnosticEvent> }`. Default Redis channel `'aviary:diagnostics:relay'`.
- **Loop prevention is mandatory and dual:** (1) receiver skips messages whose `node === nodeId` (echo); (2) a `reEmitting` WeakSet keyed on the envelope object makes the forwarder skip a re-emitted envelope. Both required.
- Channel name parsing: strip `aviary:` then split on the FIRST colon (event segment may contain dots, e.g. `durable:run.failed`).
- The relay/module never close the `pub`/`sub` connections (caller owns them) and never throw back into `emit()` or the Redis message handler.
- Peer ranges: `ioredis` `"^5"`; `@nestjs/common` + `@nestjs/core` `"^10 || ^11"`, `reflect-metadata` `"^0.2"` — the three Nest ones optional via `peerDependenciesMeta`.
- Every commit body ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work in the worktree on branch `feat/diagnostics-redis-transport`.

---

### Task 1: Package scaffold + `createDiagnosticsRedisRelay`

**Files:**
- Create: `packages/redis/package.json`, `packages/redis/tsconfig.json`, `packages/redis/vitest.config.ts`
- Create: `packages/redis/src/relay.ts`, `packages/redis/src/index.ts`
- Create: `packages/redis/test/setup.ts`, `packages/redis/test/fake-redis.ts`, `packages/redis/test/relay.spec.ts`

**Interfaces:**
- Consumes: `CHANNEL_PREFIX`, `channelName`, `getChannel`, `onChannelRegistered`, `registeredChannels`, `emit`, `resetRegistry`, `type DiagnosticEvent` from `@dudousxd/nestjs-diagnostics`.
- Produces: `createDiagnosticsRedisRelay(options): () => void`; `interface RedisLike`, `ChannelRef`, `DiagnosticsRedisRelayOptions`.

- [ ] **Step 1: Scaffold**

`packages/redis/package.json`:

```json
{
  "name": "@dudousxd/nestjs-diagnostics-redis",
  "version": "0.0.0",
  "description": "Cross-process transport for @dudousxd/nestjs-diagnostics — relay aviary:<lib>:<event> events over Redis pub/sub so @OnDiagnostic handlers fire across processes.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/DavideCarvalho/nestjs-diagnostics.git",
    "directory": "packages/redis"
  },
  "author": "Davi Carvalho <davi@goflip.ai>",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist/", "README.md", "CHANGELOG.md"],
  "sideEffects": false,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@dudousxd/nestjs-diagnostics": "workspace:^"
  },
  "peerDependencies": {
    "ioredis": "^5",
    "@nestjs/common": "^10 || ^11",
    "@nestjs/core": "^10 || ^11",
    "reflect-metadata": "^0.2"
  },
  "peerDependenciesMeta": {
    "@nestjs/common": { "optional": true },
    "@nestjs/core": { "optional": true },
    "reflect-metadata": { "optional": true }
  },
  "devDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/node": "^20.0.0",
    "ioredis": "^5.4.2",
    "reflect-metadata": "^0.2.2",
    "typescript": "^5.4.0",
    "vitest": "^3.0.0"
  },
  "engines": { "node": ">=20" },
  "keywords": ["nestjs", "diagnostics", "diagnostics-channel", "redis", "transport", "cross-process", "aviary"]
}
```

`packages/redis/tsconfig.json` (mirror telescope):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": ".tsbuildinfo",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test/**", "dist/**"]
}
```

`packages/redis/vitest.config.ts` (mirror core):

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.{spec,test}.ts'],
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
  },
});
```

`packages/redis/test/setup.ts`:

```ts
import 'reflect-metadata';
```

- [ ] **Step 2: Install**

Run from repo root: `pnpm install`
Expected: the new package links; `ioredis`, `@nestjs/*` resolve in its node_modules.

- [ ] **Step 3: Write the `FakeRedis` test double**

`packages/redis/test/fake-redis.ts`:

```ts
import type { RedisLike } from '../src/relay.js';

/** Shared in-memory pub/sub hub. FakeRedis clients on the same hub deliver to each other
 *  synchronously — simulating separate processes/connections in tests. */
export class FakeHub {
  readonly clients = new Set<FakeRedis>();
  publish(channel: string, message: string): void {
    for (const c of [...this.clients]) c._deliver(channel, message);
  }
}

export class FakeRedis implements RedisLike {
  private readonly channels = new Set<string>();
  private readonly listeners = new Set<(channel: string, message: string) => void>();
  public publishCount = 0;

  constructor(private readonly hub: FakeHub) {
    hub.clients.add(this);
  }

  publish(channel: string, message: string): number {
    this.publishCount += 1;
    this.hub.publish(channel, message);
    return 1;
  }
  subscribe(channel: string, callback?: (err: Error | null, count: number) => void): void {
    this.channels.add(channel);
    callback?.(null, this.channels.size);
  }
  unsubscribe(channel: string): void {
    this.channels.delete(channel);
  }
  on(_event: 'message', listener: (channel: string, message: string) => void): void {
    this.listeners.add(listener);
  }
  removeListener(_event: 'message', listener: (channel: string, message: string) => void): void {
    this.listeners.delete(listener);
  }
  /** Hub callback: deliver to this client's message listeners only if subscribed to the channel. */
  _deliver(channel: string, message: string): void {
    if (!this.channels.has(channel)) return;
    for (const l of [...this.listeners]) l(channel, message);
  }
}
```

- [ ] **Step 4: Write the failing test**

`packages/redis/test/relay.spec.ts`:

```ts
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
      createDiagnosticsRedisRelay({ pub: new FakeRedis(hub), sub, libs: ['resilience'], nodeId: 'B' }),
    );
    const local = vi.fn();
    getChannel('resilience', 'circuit-opened').subscribe((m) => local(m));

    // a different node publishes onto the relay channel
    const remote = new FakeRedis(hub);
    const env: DiagnosticEvent = { ts: 1, lib: 'resilience', event: 'circuit-opened', payload: { key: 'x' } };
    remote.publish(RELAY_CHANNEL, JSON.stringify({ node: 'OTHER', env }));

    expect(local).toHaveBeenCalledTimes(1);
    expect((local.mock.calls[0]?.[0] as DiagnosticEvent).payload).toEqual({ key: 'x' });
  });

  it('suppresses its own echo (node === nodeId)', () => {
    const hub = new FakeHub();
    const sub = new FakeRedis(hub);
    teardowns.push(
      createDiagnosticsRedisRelay({ pub: new FakeRedis(hub), sub, libs: ['resilience'], nodeId: 'A' }),
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
      createDiagnosticsRedisRelay({ pub: new FakeRedis(hub), sub: new FakeRedis(hub), libs: ['resilience'], nodeId: 'A' }),
    );
    const bPub = new FakeRedis(hub);
    teardowns.push(
      createDiagnosticsRedisRelay({ pub: bPub, sub: new FakeRedis(hub), libs: ['resilience'], nodeId: 'B' }),
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
      createDiagnosticsRedisRelay({ pub: new FakeRedis(hub), sub: new FakeRedis(hub), libs: ['authz'], nodeId: 'A' }),
    );

    // 'authz:decision' channel first registers at this emit, after the relay started
    emit('authz', 'decision', { allow: true });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.env.event).toBe('decision');
  });

  it('ignores malformed Redis messages without throwing', () => {
    const hub = new FakeHub();
    teardowns.push(
      createDiagnosticsRedisRelay({ pub: new FakeRedis(hub), sub: new FakeRedis(hub), all: true, nodeId: 'A' }),
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
    new FakeRedis(hub).publish(RELAY_CHANNEL, JSON.stringify({ node: 'OTHER', env: { ts: 1, lib: 'resilience', event: 'circuit-opened', payload: {} } }));

    expect(seen).toHaveLength(0);
    expect(local).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @dudousxd/nestjs-diagnostics-redis test`
Expected: FAIL — `../src/relay.js` / `createDiagnosticsRedisRelay` not found.

- [ ] **Step 6: Write the implementation**

`packages/redis/src/relay.ts`:

```ts
import { randomUUID } from 'node:crypto';
import {
  CHANNEL_PREFIX,
  channelName,
  type DiagnosticEvent,
  getChannel,
  onChannelRegistered,
  registeredChannels,
} from '@dudousxd/nestjs-diagnostics';

/** The minimal Redis pub/sub surface the relay uses. An ioredis instance satisfies it structurally. */
export interface RedisLike {
  publish(channel: string, message: string): unknown;
  subscribe(channel: string, callback?: (err: Error | null, count: number) => void): unknown;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  removeListener(event: 'message', listener: (channel: string, message: string) => void): unknown;
  unsubscribe(channel: string): unknown;
}

export interface ChannelRef {
  lib: string;
  event: string;
}

export interface DiagnosticsRedisRelayOptions {
  /** Publisher connection. */
  pub: RedisLike;
  /** Subscriber connection (separate from `pub`). For ioredis: `const sub = pub.duplicate()`. */
  sub: RedisLike;
  /** Forward every event of these libs (current + future channels). */
  libs?: string[];
  /** Forward these exact channels, in addition to `libs`. */
  channels?: ChannelRef[];
  /** Forward EVERY aviary channel (current + future). Overrides `libs`/`channels`. Default false. */
  all?: boolean;
  /** Redis channel to relay on. Default 'aviary:diagnostics:relay'. */
  redisChannel?: string;
  /** Unique id for THIS process, for echo suppression. Default a random id. */
  nodeId?: string;
}

const DEFAULT_REDIS_CHANNEL = 'aviary:diagnostics:relay';

/** Strip the `aviary:` prefix and split on the FIRST colon — the event segment may contain dots
 *  (e.g. `durable:run.failed`), but the lib/event boundary is the first colon after the prefix. */
function parseChannelName(name: string): ChannelRef | null {
  const prefix = `${CHANNEL_PREFIX}:`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const idx = rest.indexOf(':');
  if (idx <= 0 || idx === rest.length - 1) return null;
  return { lib: rest.slice(0, idx), event: rest.slice(idx + 1) };
}

/**
 * Relay diagnostics events across processes over Redis pub/sub. Forwards selected local
 * `aviary:<lib>:<event>` channels to Redis and re-emits Redis-received events onto the local bus, so
 * `@OnDiagnostic` handlers / `getChannel(...).subscribe(...)` fire cross-process. Loop-safe via nodeId
 * echo suppression and a re-emit guard. Never throws into `emit()` or the Redis handler. Does NOT
 * close the `pub`/`sub` connections — the caller owns them.
 *
 * @returns a teardown that removes all local subscriptions and the Redis message handler.
 */
export function createDiagnosticsRedisRelay(options: DiagnosticsRedisRelayOptions): () => void {
  const { pub, sub } = options;
  const redisChannel = options.redisChannel ?? DEFAULT_REDIS_CHANNEL;
  const nodeId = options.nodeId ?? randomUUID();
  const forwardAll = options.all === true;
  const libs = options.libs ?? [];
  const exact = options.channels ?? [];

  const reEmitting = new WeakSet<object>();
  const subscriptions: Array<{ ref: ChannelRef; listener: (msg: unknown) => void }> = [];
  const subscribed = new Set<string>();

  const forward = (msg: unknown): void => {
    if (typeof msg !== 'object' || msg === null) return;
    if (reEmitting.has(msg)) return; // a re-emitted remote event — do not send it back
    try {
      pub.publish(redisChannel, JSON.stringify({ node: nodeId, env: msg }));
    } catch {
      // never throw back into the synchronous emit() that triggered this
    }
  };

  const subscribeRef = (ref: ChannelRef): void => {
    const name = channelName(ref.lib, ref.event);
    if (subscribed.has(name)) return;
    getChannel(ref.lib, ref.event).subscribe(forward);
    subscribed.add(name);
    subscriptions.push({ ref, listener: forward });
  };

  const wildcardMatches = (name: string): boolean => {
    if (forwardAll) return name.startsWith(`${CHANNEL_PREFIX}:`);
    return libs.some((lib) => name.startsWith(`${CHANNEL_PREFIX}:${lib}:`));
  };

  for (const ref of exact) subscribeRef(ref);

  const hasWildcard = forwardAll || libs.length > 0;
  if (hasWildcard) {
    for (const name of registeredChannels()) {
      if (wildcardMatches(name)) {
        const ref = parseChannelName(name);
        if (ref) subscribeRef(ref);
      }
    }
  }
  const offRegistered = hasWildcard
    ? onChannelRegistered((name) => {
        if (wildcardMatches(name)) {
          const ref = parseChannelName(name);
          if (ref) subscribeRef(ref);
        }
      })
    : null;

  const onMessage = (channel: string, raw: string): void => {
    if (channel !== redisChannel) return;
    let parsed: { node?: unknown; env?: DiagnosticEvent };
    try {
      parsed = JSON.parse(raw) as { node?: unknown; env?: DiagnosticEvent };
    } catch {
      return; // ignore malformed
    }
    if (parsed.node === nodeId) return; // our own echo
    const env = parsed.env;
    if (!env || typeof env.lib !== 'string' || typeof env.event !== 'string') return;
    reEmitting.add(env);
    try {
      getChannel(env.lib, env.event).publish(env);
    } catch {
      // a local subscriber threw — never propagate into the message handler
    } finally {
      reEmitting.delete(env);
    }
  };

  sub.subscribe(redisChannel);
  sub.on('message', onMessage);

  return () => {
    for (const { ref, listener } of subscriptions) {
      getChannel(ref.lib, ref.event).unsubscribe(listener);
    }
    subscriptions.length = 0;
    subscribed.clear();
    offRegistered?.();
    sub.removeListener('message', onMessage);
    sub.unsubscribe(redisChannel);
  };
}
```

`packages/redis/src/index.ts`:

```ts
export { createDiagnosticsRedisRelay } from './relay.js';
export type { ChannelRef, DiagnosticsRedisRelayOptions, RedisLike } from './relay.js';
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @dudousxd/nestjs-diagnostics-redis test`
Expected: PASS — all 8 tests green.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @dudousxd/nestjs-diagnostics-redis typecheck`
Expected: no errors.

- [ ] **Step 9: Lint (these repos gate releases on biome)**

Run from repo root: `pnpm exec biome check --write packages/redis && pnpm exec biome check packages/redis`
Expected: second command exits clean (no errors). Stage any files biome rewrote.

- [ ] **Step 10: Commit**

```bash
git add packages/redis pnpm-lock.yaml
git commit -F - <<'EOF'
feat(redis): cross-process diagnostics relay over Redis pub/sub

New @dudousxd/nestjs-diagnostics-redis package. createDiagnosticsRedisRelay(options)
forwards selected local aviary:<lib>:<event> channels to Redis and re-emits
Redis-received events onto the local bus, so @OnDiagnostic handlers fire across
processes. Loop-safe via nodeId echo suppression + a reEmitting WeakSet guard;
never throws into emit() or the Redis handler. Coded against a minimal RedisLike
interface (ioredis satisfies it).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: `DiagnosticsRedisModule`

**Files:**
- Create: `packages/redis/src/diagnostics-redis.module.ts`
- Modify: `packages/redis/src/index.ts` (export the module)
- Test: `packages/redis/test/diagnostics-redis.module.spec.ts`

**Interfaces:**
- Consumes: `ModuleRef`-free — takes the relay options directly; Nest lifecycle hooks from `@nestjs/common`; `createDiagnosticsRedisRelay` + `DiagnosticsRedisRelayOptions` from Task 1.
- Produces: `DiagnosticsRedisModule.forRoot(options): DynamicModule`; `interface DiagnosticsRedisModuleOptions`.

- [ ] **Step 1: Write the failing test**

`packages/redis/test/diagnostics-redis.module.spec.ts`:

```ts
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
  publish() {}, subscribe() {}, on() {}, removeListener() {}, unsubscribe() {},
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
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      expect(relayFactory).toHaveBeenCalledTimes(1);
      expect(relayFactory).toHaveBeenCalledWith(opts);
    } finally {
      await app.close();
    }
  });

  it('tears the relay down on shutdown', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiagnosticsRedisModule.forRoot({ pub: fakeClient, sub: fakeClient, all: true })],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    expect(teardownSpy).not.toHaveBeenCalled();
    await app.close();
    expect(teardownSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dudousxd/nestjs-diagnostics-redis test`
Expected: FAIL — `../src/diagnostics-redis.module.js` / `DiagnosticsRedisModule` not found.

- [ ] **Step 3: Write the module**

`packages/redis/src/diagnostics-redis.module.ts`:

```ts
import {
  type DynamicModule,
  Global,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  createDiagnosticsRedisRelay,
  type DiagnosticsRedisRelayOptions,
} from './relay.js';

export interface DiagnosticsRedisModuleOptions extends DiagnosticsRedisRelayOptions {}

const RELAY_OPTIONS = Symbol('diagnostics-redis:options');

@Injectable()
class DiagnosticsRedisStarter implements OnApplicationBootstrap, OnApplicationShutdown {
  private teardown: (() => void) | null = null;

  constructor(private readonly options: DiagnosticsRedisModuleOptions) {}

  onApplicationBootstrap(): void {
    this.teardown = createDiagnosticsRedisRelay(this.options);
  }

  onApplicationShutdown(): void {
    this.teardown?.();
    this.teardown = null;
  }
}

/**
 * Import once at the app root to relay diagnostics events across processes over Redis. Supply your
 * `pub` / `sub` ioredis connections (e.g. `redis` and `redis.duplicate()`) and the channel selection.
 * The module manages only the relay's subscriptions — it does NOT open or close your Redis clients.
 *
 * ```ts
 * @Module({ imports: [DiagnosticsRedisModule.forRoot({ pub: redis, sub: redis.duplicate(), libs: ['durable'] })] })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class DiagnosticsRedisModule {
  static forRoot(options: DiagnosticsRedisModuleOptions): DynamicModule {
    return {
      module: DiagnosticsRedisModule,
      providers: [
        { provide: RELAY_OPTIONS, useValue: options },
        {
          provide: DiagnosticsRedisStarter,
          useFactory: (opts: DiagnosticsRedisModuleOptions) => new DiagnosticsRedisStarter(opts),
          inject: [RELAY_OPTIONS],
        },
      ],
    };
  }
}
```

- [ ] **Step 4: Export the module from the barrel**

Append to `packages/redis/src/index.ts`:

```ts
export { DiagnosticsRedisModule } from './diagnostics-redis.module.js';
export type { DiagnosticsRedisModuleOptions } from './diagnostics-redis.module.js';
```

(Keep the Task 1 exports above these lines.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @dudousxd/nestjs-diagnostics-redis test`
Expected: PASS — module tests (2) plus the relay tests (8) all green.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @dudousxd/nestjs-diagnostics-redis typecheck`
Then from repo root: `pnpm exec biome check --write packages/redis && pnpm exec biome check packages/redis`
Expected: typecheck clean; biome clean (stage any rewrites).

- [ ] **Step 7: Commit**

```bash
git add packages/redis/src packages/redis/test
git commit -F - <<'EOF'
feat(redis): DiagnosticsRedisModule for app-lifecycle relay wiring

Global Nest module that starts the Redis relay on application bootstrap and tears
it down on shutdown. Takes the relay options (pub/sub clients + channel selection)
directly; does not own the Redis connections.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: README + changeset

**Files:**
- Create: `packages/redis/README.md`
- Create: `.changeset/diagnostics-redis.md`

- [ ] **Step 1: Write the README**

`packages/redis/README.md`:

````markdown
# @dudousxd/nestjs-diagnostics-redis

Cross-process transport for [`@dudousxd/nestjs-diagnostics`](https://github.com/DavideCarvalho/nestjs-diagnostics).
A consumer-side **relay** forwards selected local `aviary:<lib>:<event>` channels onto Redis pub/sub
and re-emits Redis-received events back onto the local diagnostics bus — so `@OnDiagnostic` handlers
and `getChannel(...).subscribe(...)` reactions fire **across processes/pods**. The diagnostics core
stays in-process and untouched; this is entirely opt-in.

## Install

```bash
pnpm add @dudousxd/nestjs-diagnostics-redis @dudousxd/nestjs-diagnostics ioredis
```

## Use (Nest)

Supply your own ioredis connections — a publisher and a **separate** subscriber (`redis.duplicate()`,
since a subscribed connection can't publish):

```ts
import Redis from 'ioredis';
import { DiagnosticsRedisModule } from '@dudousxd/nestjs-diagnostics-redis';

const redis = new Redis(process.env.REDIS_URL);

@Module({
  imports: [
    DiagnosticsRedisModule.forRoot({
      pub: redis,
      sub: redis.duplicate(),
      libs: ['durable', 'notifications'], // forward all events of these libs
    }),
  ],
})
export class AppModule {}
```

Now an `@OnDiagnostic('durable', 'run.failed')` handler in **another** process fires when a worker
elsewhere emits it.

## Use (manual)

```ts
import { createDiagnosticsRedisRelay } from '@dudousxd/nestjs-diagnostics-redis';

const teardown = createDiagnosticsRedisRelay({
  pub: redis,
  sub: redis.duplicate(),
  channels: [{ lib: 'resilience', event: 'circuit-opened' }], // exact channels
  // or: libs: ['durable'] | all: true
});
// ... later
teardown();
```

## How it works

- **Forwarder:** subscribes to the selected local channels; each event is published to Redis as
  `{ node, env }` (the diagnostics envelope).
- **Receiver:** subscribes to the Redis channel; each message from a *different* node is re-emitted
  locally via the diagnostics bus, so all local subscribers fire.
- **Loop-safe:** the receiver skips its own echoes (`node === nodeId`) and a re-emit guard stops a
  received event from being forwarded back — so two processes never ping-pong.

## Notes

- **Payloads cross a process boundary as JSON** — class instances arrive as plain objects (no
  methods/prototype), `Date` as an ISO string. Read fields, not behavior, in cross-process handlers.
- **Fire-and-forget**, like the in-process bus: no guaranteed delivery, ordering, or replay.
- The relay never opens or closes your Redis connections — you own their lifecycle. It never throws
  back into `emit()`.
````

- [ ] **Step 2: Write the changeset**

`.changeset/diagnostics-redis.md`:

```markdown
---
"@dudousxd/nestjs-diagnostics-redis": minor
---

Add `@dudousxd/nestjs-diagnostics-redis`: a consumer-side relay that forwards selected `aviary:<lib>:<event>` diagnostics channels over Redis pub/sub and re-emits remote events onto the local bus, so `@OnDiagnostic` handlers fire across processes. Ships `createDiagnosticsRedisRelay(options)` and a global `DiagnosticsRedisModule`. Loop-safe (nodeId echo suppression + re-emit guard); coded against a minimal `RedisLike` interface (ioredis satisfies it). The diagnostics core stays in-process and untouched.
```

- [ ] **Step 3: Build + full package suite + lint**

Run: `pnpm --filter @dudousxd/nestjs-diagnostics-redis build`
Expected: `dist/index.js`, `dist/index.d.ts`, `dist/relay.js`, `dist/diagnostics-redis.module.js` produced.

Run: `pnpm --filter @dudousxd/nestjs-diagnostics-redis test`
Expected: all 10 tests pass.

Run from repo root: `pnpm exec biome check packages/redis`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/redis/README.md .changeset/diagnostics-redis.md
git commit -F - <<'EOF'
docs(redis): README and changeset for nestjs-diagnostics-redis

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage:**
- `createDiagnosticsRedisRelay` (forwarder, receiver, two loop guards, channel selection exact/libs/all + future, teardown, JSON wire format, never-throw) → Task 1. ✅
- `RedisLike` interface + `FakeRedis` test double → Task 1. ✅
- `DiagnosticsRedisModule.forRoot()` (bootstrap start / shutdown teardown) → Task 2. ✅
- Package mirrors telescope build (tsc ESM, tsconfig, per-package vitest swc) → Task 1 scaffold. ✅
- ioredis peer + @nestjs optional peers → Task 1 package.json. ✅
- Lint gate (biome) run before each commit → Steps 9 / 6 / 3. ✅
- README + changeset → Task 3. ✅

**Type consistency:** `createDiagnosticsRedisRelay(options: DiagnosticsRedisRelayOptions): () => void` referenced identically in Tasks 1 and 2. `DiagnosticsRedisModuleOptions extends DiagnosticsRedisRelayOptions`. `ChannelRef { lib, event }` used consistently. Channel parsing (`parseChannelName`) is the inverse of `channelName`.

**Notes for the implementer (flagged, not placeholders):**
- Task 1 tests rely on the `FakeHub` delivering synchronously, which makes the loop-prevention assertion (`bPub.publishCount` unchanged) deterministic. If `getChannel(...).subscribe` typing requires the listener to accept `unknown`, the `forward`/spy signatures already use `unknown`/`(m) => ...`.
- Task 2 mocks the relay factory with `vi.mock('../src/relay.js', importOriginal)` so `DiagnosticsRedisRelayOptions` and other exports remain real while only `createDiagnosticsRedisRelay` is spied. If Nest requires `app.enableShutdownHooks()` for `onApplicationShutdown` under the testing harness, the `app.close()` path already triggers it; otherwise add `app.enableShutdownHooks()` after `app.init()` (assertion intent unchanged).
