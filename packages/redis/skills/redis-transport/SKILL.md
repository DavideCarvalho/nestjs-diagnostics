---
name: redis-transport
description: "Relay @dudousxd/nestjs-diagnostics events across processes/pods over Redis pub/sub. The relay lives in `@dudousxd/nestjs-diagnostics` (`createDiagnosticsRedisRelay`, re-exported by `@dudousxd/nestjs-diagnostics-redis`) and is started via `DiagnosticsModule` `transports.redis()` or `DiagnosticsRedisModule.forRoot`/`forRootAsync({ pub, sub, receive, libs, channels, all }) wires it from DI; createDiagnosticsRedisRelay() is the manual form returning a teardown. Forwards selected local aviary:<lib>:<event> channels to Redis and re-emits remote events locally so @OnDiagnostic fires cross-process. Needs separate pub and sub ioredis connections (redis.duplicate()) unless `receive: false` publish-only; loop-safe via nodeId echo suppression with re-emitted copies marked (`isRelayed`); envelopes keep their `id`; payloads cross as JSON."
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-diagnostics-redis"
  library_version: 0.1.2
  framework: nestjs
---

# Cross-process diagnostics over Redis

The Redis relay is an opt-in **relay**: it forwards selected
local `aviary:<lib>:<event>` channels onto Redis pub/sub and re-emits
Redis-received events back onto the local diagnostics bus — so `@OnDiagnostic`
handlers and `getChannel(...).subscribe(...)` reactions fire **across
processes/pods**. It lives in `@dudousxd/nestjs-diagnostics`
(`createDiagnosticsRedisRelay`); `@dudousxd/nestjs-diagnostics-redis`
re-exports it and provides `DiagnosticsRedisModule`. The same relay also
starts as `DiagnosticsModule` `transports.redis()` (libs with listeners are
forwarded automatically).

## Setup

```bash
pnpm add @dudousxd/nestjs-diagnostics-redis @dudousxd/nestjs-diagnostics ioredis
```

Supply your own ioredis connections — a publisher and a **separate** subscriber
(`redis.duplicate()`, since a subscribed connection can't publish), unless
`receive: false` for a publish-only relay (then `sub` is optional, e.g. a
`role: 'api'` process that publishes and never subscribes). Prefer
`forRootAsync` so the relay's clients come from the same DI container:

```ts
import type Redis from 'ioredis';
import { Module } from '@nestjs/common';
import { DiagnosticsRedisModule } from '@dudousxd/nestjs-diagnostics-redis';
import { REDIS, RedisModule } from './redis.module';

@Module({
  imports: [
    DiagnosticsRedisModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        pub: redis,
        sub: redis.duplicate(),
        libs: ['durable', 'notifications'], // forward all events of these libs
      }),
    }),
  ],
})
export class AppModule {}
```

Now an `@OnDiagnostic('durable', 'run.failed')` handler in **another** process
fires when a worker elsewhere emits it.

Source: `packages/redis/src/diagnostics-redis.module.ts`, `packages/core/src/redis-relay.ts` (re-exported by `packages/redis/src/relay.ts`).

## Core patterns

### 1. Selecting what to forward: libs, channels, all

The relay options pick which local channels are forwarded:

- `libs: ['durable']` — every `aviary:durable:*` channel (current + future).
- `channels: [{ lib: 'resilience', event: 'circuit-opened' }]` — exact channels.
- `all: true` — every `aviary:*` channel; overrides `libs`/`channels`.

```ts
DiagnosticsRedisModule.forRoot({
  pub: redis,
  sub: redis.duplicate(),
  channels: [{ lib: 'resilience', event: 'circuit-opened' }],
});
```

Wildcard selections subscribe to matching channels at startup and via
`onChannelRegistered` for ones that appear later.

Source: `packages/core/src/redis-relay.ts` (`wildcardMatches`, `subscribeRef`, `DiagnosticsRedisRelayOptions`).

### 2. Manual relay outside Nest

`createDiagnosticsRedisRelay(options)` returns a `teardown()` that first
publishes any queued events, then removes all local subscriptions and the Redis
message handler. It never opens or closes your Redis connections — you own their
lifecycle:

```ts
import { createDiagnosticsRedisRelay } from '@dudousxd/nestjs-diagnostics';

const teardown = createDiagnosticsRedisRelay({
  pub: redis,
  sub: redis.duplicate(),
  libs: ['durable'],
});
// publish-only (never subscribes; sub optional):
// createDiagnosticsRedisRelay({ pub: redis, receive: false, libs: ['durable'] });
// … later
teardown();
```

Re-exported unchanged from `@dudousxd/nestjs-diagnostics-redis`, so the old
import path keeps working. Forwarding is batched off the emitter's call stack: `emit()` only queues the
event, and the queue is serialized and published once per event loop turn in emit
order (one Redis message per event, unchanged wire format, `id` kept) — via a single
pipeline when the turn queued more than one event and `pub` supports
`pipeline()`, otherwise one `publish` per message.

Source: `packages/core/src/redis-relay.ts` (`createDiagnosticsRedisRelay` `forward`/`flush`).

### 3. Loop-safety

Each relay tags its publishes with a per-process `nodeId`. The receiver skips its
own echoes (`node === nodeId`) and a re-emit guard stops a
received event from being forwarded back — so two processes never ping-pong.
Re-emitted copies are marked (`isRelayed`) so delivering transports
(`queue`, `durable`) deliver only at the origin and never twice; the envelope
keeps its `id` across the hop. The
default Redis channel is `aviary:diagnostics:relay` (override with
`redisChannel`).

Source: `packages/core/src/redis-relay.ts` (`forward`, `onMessage`, `reEmitting`), `packages/core/src/relayed.ts` (`isRelayed`).

## Common mistakes

### Reusing one ioredis connection for both pub and sub

```ts
// Wrong — once `sub` enters subscriber mode it can't publish; commands error.
const conn = new Redis();
DiagnosticsRedisModule.forRoot({ pub: conn, sub: conn, libs: ['durable'] });
```

```ts
// Correct — a separate subscriber via duplicate().
const redis = new Redis();
DiagnosticsRedisModule.forRoot({ pub: redis, sub: redis.duplicate(), libs: ['durable'] });
```

ioredis puts a connection that has `subscribe`d into subscriber mode where most
commands (including `publish`) are rejected — the relay needs two connections,
unless `receive: false` (publish-only, no `sub`).
Source: `packages/core/src/redis-relay.ts` (`sub` docs: "separate from `pub`").

### Reading methods/Date on a cross-process payload

```ts
// Wrong — across the boundary the payload is plain JSON; methods/prototype are gone.
@OnDiagnostic('durable', 'run.failed')
onFail(e: DiagnosticEvent<RunFailed>) {
  e.payload.failedAt.getTime(); // failedAt is an ISO string, not a Date — throws
}
```

```ts
// Correct — read fields, and parse serialized values yourself.
onFail(e: DiagnosticEvent<{ failedAt: string }>) {
  const at = new Date(e.payload.failedAt).getTime();
}
```

Payloads cross the process boundary as JSON: class instances arrive as plain
objects (no methods/prototype), `Date` as an ISO string. Read fields, not
behavior, in cross-process handlers.
Source: `packages/core/src/redis-relay.ts` (`forward`/`onMessage` JSON), redis README "Notes".

### Expecting the module to manage your Redis connection lifecycle

```ts
// Wrong — assuming the module connects/quits Redis for you.
DiagnosticsRedisModule.forRoot({ pub: redis, sub: redis.duplicate(), libs: ['durable'] });
// (no redis.quit() anywhere) — connections leak on shutdown
```

```ts
// Correct — you own connect/quit; the module only manages relay subscriptions.
// e.g. in your Redis provider's onApplicationShutdown: await redis.quit();
```

The relay teardown first publishes any queued events, then removes its own
subscriptions and Redis message handler; it never opens or closes `pub`/`sub`.
Manage their lifecycle in your own provider.
Source: `packages/redis/src/diagnostics-redis.module.ts` (`DiagnosticsRedisStarter` teardown),
`packages/core/src/redis-relay.ts` (return teardown).
