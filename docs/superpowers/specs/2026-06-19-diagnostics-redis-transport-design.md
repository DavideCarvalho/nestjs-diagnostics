# `@dudousxd/nestjs-diagnostics-redis` — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan
**Repo:** `nestjs-diagnostics` (new `packages/redis` package)

## Goal

Make Aviary diagnostics events cross **process boundaries** without changing the core. A consumer-side
**relay** forwards selected local `aviary:<lib>:<event>` channels onto Redis pub/sub, and re-emits
events received from Redis back onto the local diagnostics bus — so the same `@OnDiagnostic` handlers
and `getChannel(...).subscribe(...)` reactions fire across processes/pods. Roadmap item #3 of
"diagnostics as the unified ecosystem event bus".

The core stays **in-process and untouched** (`emit` keeps its zero-cost-when-unsubscribed guarantee).
This package is entirely opt-in and lives outside the emit path: it only ever observes channels that
already have subscribers and re-publishes locally.

## Background & constraints

- **Diagnostics primitives used** (all exported from `@dudousxd/nestjs-diagnostics`):
  - `getChannel(lib, event): Channel` — the memoized Node `diagnostics_channel`. `.subscribe(fn)` /
    `.unsubscribe(fn)` to observe; `.publish(envelope)` to inject an event (used to re-emit remotes).
  - `registeredChannels(): string[]` and `onChannelRegistered(cb): () => void` — discover current +
    future channels (no wildcard in `diagnostics_channel`); same mechanism the `@OnDiagnostic`
    explorer uses.
  - `channelName(lib, event)` → `aviary:<lib>:<event>`; `CHANNEL_PREFIX = 'aviary'`.
  - `type DiagnosticEvent` = `{ v?: number; ts: number; lib: string; event: string; traceId?: string;
    payload: unknown }`. The envelope **carries its own `lib`/`event`**, so a single forward listener
    serves every channel.
- **`diagnostics_channel.publish` is synchronous** — a subscriber runs inside the publisher's call
  stack. This is what makes the loop-prevention guard (below) reliable: the re-emit's downstream
  forward listener runs synchronously within the receiver's `publish()` call.
- **Redis client = `ioredis ^5`** (the ecosystem standard across durable/resilience/notifications).
  Redis pub/sub requires a **dedicated subscriber connection** (a subscribed connection can't
  `publish`). The relay therefore takes a `pub` and a `sub` client. It is coded against a minimal
  **`RedisLike`** structural interface (ioredis satisfies it), so it is testable with a fake and a
  future `-nats` package can reuse the relay logic.
- **Build:** `tsc` ESM-only, NodeNext, Node ≥20 — **mirror `packages/telescope`** (package.json /
  tsconfig / vitest.config). Tests live in `test/` (excluded from the build tsconfig) and run under a
  per-package `vitest.config.ts` (swc with `decorators` + `decoratorMetadata`, `setupFiles:
  ['./test/setup.ts']` importing `reflect-metadata`, `include: ['test/**/*.{spec,test}.ts']`).

**Reference implementations:**
- `packages/core/src/nestjs/diagnostics.explorer.ts` — the exact/wildcard channel subscription via
  `registeredChannels()` + `onChannelRegistered()`, and the subscribe/unsubscribe bookkeeping.
- `packages/telescope/{package.json,tsconfig.json,vitest.config.ts}` — the packaging/build/test
  template.

## Decision: package shape

A **new package `@dudousxd/nestjs-diagnostics-redis`** (`packages/redis`). Two surfaces:

1. **`createDiagnosticsRedisRelay(options)`** — the framework-free primitive. Sets up the forwarder
   (local channels → Redis) and the receiver (Redis → local re-emit). Returns a teardown function.
2. **`DiagnosticsRedisModule.forRoot(options)`** — a global Nest module that starts the relay on
   application bootstrap and tears it down on shutdown.

`@dudousxd/nestjs-diagnostics` is a runtime **dependency** (`workspace:^`, like telescope). `ioredis`
is a **peer** (`^5`); `@nestjs/common` + `@nestjs/core` + `reflect-metadata` are **optional peers**
(only the module needs them).

## The `RedisLike` interface

The minimal pub/sub surface the relay uses (ioredis instances satisfy it structurally):

```ts
export interface RedisLike {
  publish(channel: string, message: string): unknown;
  subscribe(channel: string, callback?: (err: Error | null, count: number) => void): unknown;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  removeListener(event: 'message', listener: (channel: string, message: string) => void): unknown;
  unsubscribe(channel: string): unknown;
}
```

## Component 1 — `createDiagnosticsRedisRelay`

```ts
export interface ChannelRef { lib: string; event: string }

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
  /** Redis channel the relay publishes to / subscribes on. Default 'aviary:diagnostics:relay'. */
  redisChannel?: string;
  /** Unique id for THIS process, for echo suppression. Default a random id (crypto.randomUUID()). */
  nodeId?: string;
}

export function createDiagnosticsRedisRelay(options: DiagnosticsRedisRelayOptions): () => void;
```

### Wire format

Each forwarded event is published to Redis as JSON: `{ "node": "<nodeId>", "env": <DiagnosticEvent> }`.
`env` is the diagnostics envelope verbatim. **Payloads are serialized with `JSON.stringify`** — so a
cross-process consumer receives plain objects (class instances lose their prototype/methods, `Date`
becomes an ISO string). This is inherent to crossing a process boundary and is documented in the
README.

### Forwarder (local → Redis)

A single forward listener serves all selected channels (the envelope carries `lib`/`event`):

```ts
const reEmitting = new WeakSet<object>();   // envelopes currently being re-emitted (loop guard)

const forward = (msg: unknown): void => {
  if (typeof msg !== 'object' || msg === null) return;
  if (reEmitting.has(msg)) return;          // a re-emitted remote event — do NOT send it back
  try {
    pub.publish(redisChannel, JSON.stringify({ node: nodeId, env: msg }));
  } catch {
    // never throw back into the synchronous emit() that triggered this
  }
};
```

Channel selection (mirrors the `@OnDiagnostic` explorer):
- **Exact** (`channels[i]`): `getChannel(lib, event).subscribe(forward)`; record `(name, forward)`.
- **Lib wildcard** (`libs[i]`): for every `registeredChannels()` name starting with
  `aviary:<lib>:`, subscribe `forward`; record a wildcard prefix.
- **`all`**: subscribe every current `registeredChannels()` name; record an "all" flag.
- After the initial pass, attach **one** `onChannelRegistered((name) => { if name matches any
  wildcard/all and not already subscribed: getChannel-from-name.subscribe(forward) })` and keep its
  off-handle. (Resolve `lib`/`event` from `name` by stripping `aviary:` and splitting on the first
  `:` — the event segment may itself contain dots, e.g. `durable:run.failed`, so split only on the
  FIRST colon after the prefix.)

Subscribing flips `hasSubscribers`, so producers begin publishing those channels even if nothing else
locally subscribed — that is the intended behavior (the remote side is the subscriber).

### Receiver (Redis → local re-emit)

```ts
const onMessage = (channel: string, raw: string): void => {
  if (channel !== redisChannel) return;
  let parsed: { node?: unknown; env?: DiagnosticEvent };
  try { parsed = JSON.parse(raw); } catch { return; }            // ignore malformed
  const env = parsed.env;
  if (parsed.node === nodeId) return;                            // our own echo — skip
  if (!env || typeof env.lib !== 'string' || typeof env.event !== 'string') return;
  reEmitting.add(env);
  try {
    getChannel(env.lib, env.event).publish(env);                // synchronous → forward sees the guard
  } catch {
    // a local subscriber threw; never propagate into the Redis message handler
  } finally {
    reEmitting.delete(env);
  }
};

sub.subscribe(redisChannel);
sub.on('message', onMessage);
```

### Loop prevention (the critical guarantee) — two independent guards

Both are required; each alone is insufficient when two processes are **both** forwarder+receiver on
the same channel:

1. **Echo suppression (`node === nodeId`):** the receiver never re-emits an event that *this* process
   forwarded. Without it, a forwarder+receiver process re-emits its own events → local duplicate.
2. **Re-emit guard (`reEmitting` WeakSet):** while the receiver re-emits an envelope, the forwarder's
   synchronous listener sees that exact envelope object in the set and skips re-publishing it. Without
   it, process B re-emits A's event and immediately re-forwards it → A re-emits → … infinite loop.

The WeakSet keys on the **envelope object identity** (Node passes the same object reference
synchronously to subscribers), so it suppresses only the specific re-emitted envelope — a brand-new
event emitted by a handler *reacting* to a remote event (a different object) is still forwarded
normally.

### Teardown

The returned function: `getChannel(...).unsubscribe(forward)` for every recorded subscription; call
the `onChannelRegistered` off-handle; `sub.removeListener('message', onMessage)` and
`sub.unsubscribe(redisChannel)`. It does **not** close the `pub`/`sub` connections — the caller owns
them (see the module for the managed-lifecycle path).

## Component 2 — `DiagnosticsRedisModule`

```ts
export interface DiagnosticsRedisModuleOptions extends DiagnosticsRedisRelayOptions {}

@Global()
@Module({})
export class DiagnosticsRedisModule {
  static forRoot(options: DiagnosticsRedisModuleOptions): DynamicModule;
}
```

Provides an injectable implementing `OnApplicationBootstrap` (calls `createDiagnosticsRedisRelay`,
stores the teardown) and `OnApplicationShutdown` (calls the teardown). The caller supplies the `pub`
/ `sub` ioredis clients (e.g. from their own Redis module) and the channel selection. The module does
**not** open or close the Redis connections — it manages only the relay's subscriptions, mirroring
the "caller owns the clients" stance of the primitive.

```ts
@Module({
  imports: [
    DiagnosticsRedisModule.forRoot({
      pub: redis,
      sub: redis.duplicate(),
      libs: ['durable', 'notifications'],
    }),
  ],
})
export class AppModule {}
```

## Public exports (`src/index.ts`)

```ts
export { createDiagnosticsRedisRelay } from './relay.js';
export type { DiagnosticsRedisRelayOptions, ChannelRef, RedisLike } from './relay.js';
export { DiagnosticsRedisModule } from './diagnostics-redis.module.js';
export type { DiagnosticsRedisModuleOptions } from './diagnostics-redis.module.js';
```

## File structure

```
packages/redis/
├── package.json            # mirrors packages/telescope/package.json (+ ioredis peer, @nestjs optional peers)
├── tsconfig.json           # mirrors packages/telescope/tsconfig.json
├── vitest.config.ts        # mirrors packages/core/vitest.config.ts (swc decorators)
├── README.md
├── src/
│   ├── index.ts
│   ├── relay.ts                       # RedisLike, options, createDiagnosticsRedisRelay
│   └── diagnostics-redis.module.ts    # DiagnosticsRedisModule
└── test/
    ├── setup.ts                       # import 'reflect-metadata'
    ├── fake-redis.ts                  # in-memory RedisLike pub/sub double (for tests)
    ├── relay.spec.ts
    └── diagnostics-redis.module.spec.ts
```

Plus a changeset (minor; new package).

## Testing

A **`FakeRedis`** test double implements `RedisLike` as an in-memory pub/sub hub: `publish(ch, msg)`
synchronously (or via `queueMicrotask`) delivers to every `FakeRedis` subscribed to `ch` on the same
shared hub. Two `FakeRedis` instances sharing a hub simulate two processes; pairing them as
`{pub, sub}` per relay simulates each process's two connections. Reset diagnostics state with
`resetRegistry()` and tear down relays in `afterEach`.

**`relay.spec.ts`:**
- **forward:** a relay with `libs:['resilience']`; `emit('resilience','circuit-opened', p)` locally
  publishes `{node, env}` to the Redis channel (assert the fake hub saw it; `env.payload === p`).
- **receive + re-emit:** a message arriving on the Redis channel (from a *different* node) is
  re-emitted locally — a `getChannel('resilience','circuit-opened').subscribe` spy fires with the
  envelope.
- **echo suppression:** a message whose `node` equals the relay's `nodeId` is NOT re-emitted.
- **two-process round trip:** relay A (node A) and relay B (node B) on a shared hub, both forwarding
  `resilience`; `emit` on A's side reaches a local subscriber on B's side exactly once.
- **loop prevention:** in the two-process setup, the event is delivered to B's subscriber **exactly
  once** and does **not** bounce back to A's subscribers a second time (assert call counts settle;
  no infinite loop / no duplicate). Specifically: B re-emitting the event does not re-forward it to
  Redis.
- **channel selection:** `channels:[{lib:'durable',event:'run.failed'}]` forwards
  `aviary:durable:run.failed` but not `aviary:durable:run.started`; `all:true` forwards any lib;
  a **future** channel (first emitted after relay start) is forwarded (proves `onChannelRegistered`).
- **dotted event names:** `durable:run.failed` round-trips (the `aviary:` prefix is stripped and the
  split is on the first colon only).
- **malformed Redis message** (`'not json'`, or `{}` with no `env`) is ignored without throwing.
- **never-throw:** a local subscriber that throws on re-emit does not propagate out of the Redis
  message handler; a forward whose `pub.publish` throws does not propagate into `emit`.
- **teardown:** after the returned teardown, a local `emit` no longer publishes to Redis and an
  incoming Redis message no longer re-emits locally.

**`diagnostics-redis.module.spec.ts`** (`@nestjs/testing`): mock `createDiagnosticsRedisRelay` (via
`vi.hoisted` + `vi.mock`) and assert the module calls it once with the options on bootstrap and calls
the returned teardown on shutdown — isolating the module's wiring from the relay's behavior (the
latter covered by `relay.spec.ts`), the proven pattern from the durable/notifications diagnostics
modules.

## Out of scope (v1)

- **Owning Redis connection lifecycle** (opening/closing clients, reconnect/retry) — the caller (or
  their Redis module) owns the clients; ioredis already reconnects.
- **Guaranteed delivery / ordering / replay** — this is fire-and-forget pub/sub, matching the
  in-process `diagnostics_channel` semantics. Durable cross-process delivery is a separate concern.
- **A `-nats` (or other) backend** — the `RedisLike` seam leaves room for it; not built now.
- **Pluggable serialization** — JSON only in v1.
