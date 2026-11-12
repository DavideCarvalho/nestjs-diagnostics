# @dudousxd/nestjs-diagnostics-redis

## 0.4.0

### Minor Changes

- [#83](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/83) [`8165587`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/8165587650f3809b417b2b9294d6a8a5ab490a2a) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - **Breaking:** require Node.js 24 or newer (`engines.node` is now `>=24`, was `>=20`). CI tests on Node 24 and 26. No API changes: see the Upgrading page in the docs.

### Patch Changes

- Updated dependencies [[`8165587`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/8165587650f3809b417b2b9294d6a8a5ab490a2a)]:
  - @dudousxd/nestjs-diagnostics@0.10.0

## 0.3.0

### Minor Changes

- [#81](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/81) [`ebdacd0`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/ebdacd09676892eca5bf2d359b6edd8079600015) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Listeners with delivery transports and `role`.

  - Every envelope from `emit` and `trace` carries a unique `id` (a UUID). Relays keep it, so the same event has the same `id` in every process.
  - `@OnDiagnostic(lib, event?)` accepts a `RegExp` for `event`, and checks the handler's parameter against the `ChannelRegistry` payload for registered channels. Each listener has a stable id, `<ClassName>#<method>`; two listener classes with the same name fail the bootstrap.
  - `DiagnosticsModule.forRoot({ default, transports, role, nodeId })` and `forRootAsync(...)` select how listeners run across processes, with the `transports` factory:
    - `transports.redis({ pub, sub })`: broadcast over Redis pub/sub, best-effort.
    - `transports.queue({ connection })`: one BullMQ job per `(listener, event)`, retried when the handler throws (optional peer `bullmq`).
    - `transports.durable(options)`: one durable run per `(listener, event)` through `@dudousxd/nestjs-durable-diagnostics/delivery`, imported only when selected; bootstrap fails with a clear message when it is missing or durable is not configured.
      With `queue` and `durable`, delivery happens once, from the emitting process.
  - `role: 'all' | 'api' | 'worker'`: `'api'` emits and hands work to the transport but never consumes or runs listeners. `'api'`/`'worker'` without a `default` transport fail the bootstrap.
  - The Redis relay now lives in `@dudousxd/nestjs-diagnostics` (`createDiagnosticsRedisRelay`); `@dudousxd/nestjs-diagnostics-redis` re-exports it. It takes `receive: false` for a publish-only relay (then `sub` is optional), and marks re-emitted copies (`isRelayed`).

### Patch Changes

- Updated dependencies [[`ebdacd0`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/ebdacd09676892eca5bf2d359b6edd8079600015)]:
  - @dudousxd/nestjs-diagnostics@0.9.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`f4c910b`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/f4c910b0651ee9419aa452268f23646533d10306)]:
  - @dudousxd/nestjs-diagnostics@0.8.0

## 0.2.4

### Patch Changes

- [#64](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/64) [`4306143`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/43061439ba0e7aba4f506b9d54aa8640a9c47ecb) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Forward relayed events off the emitter's call stack. `emit()` no longer serializes and publishes to Redis synchronously: selected events are queued and, once per event loop turn, sent in emit order as a single pipeline (one Redis message per event, same wire format). Queued events are published when the relay is torn down.

## 0.2.3

### Patch Changes

- [`96d300d`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/96d300d3af86b77fbdf16b307d986aec922945c4) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - add NestJS 12 to the supported peer range

- Updated dependencies [[`96d300d`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/96d300d3af86b77fbdf16b307d986aec922945c4)]:
  - @dudousxd/nestjs-diagnostics@0.7.1

## 0.2.2

### Patch Changes

- Updated dependencies [[`1568de4`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/1568de44f05770ad2559f7d6d4ea38d9d213d7e5)]:
  - @dudousxd/nestjs-diagnostics@0.7.0

## 0.2.1

### Patch Changes

- [#14](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/14) [`cced7fc`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/cced7fc843c84eaf7b51686321294355bf2dd346) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Ship TanStack Intent agent skills (SKILL.md) inside the package.

- Updated dependencies [[`cced7fc`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/cced7fc843c84eaf7b51686321294355bf2dd346)]:
  - @dudousxd/nestjs-diagnostics@0.6.1

## 0.2.0

### Minor Changes

- [`af1dcf1`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/af1dcf149534b0cc211cd60ac2a470182e71ce44) - Add `DiagnosticsRedisModule.forRootAsync({ imports?, inject?, useFactory })` so the relay's `pub`/`sub` ioredis clients can come from DI instead of a top-level `new Redis(...)`. `forRoot` still works for pre-built connections.

## 0.1.2

### Patch Changes

- Updated dependencies [[`16bd3a5`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/16bd3a5ae975edb8e8b9b8ea59d52e7a9a0b470f)]:
  - @dudousxd/nestjs-diagnostics@0.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`ade4cad`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/ade4cad4ce96dc1e8a83d136f7f15477cf3183fb)]:
  - @dudousxd/nestjs-diagnostics@0.5.0

## 0.1.0

### Minor Changes

- [`283755d`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/283755dfb78ca0b31ed37abfe56855dff93597a4) - Add `@dudousxd/nestjs-diagnostics-redis`: a consumer-side relay that forwards selected `aviary:<lib>:<event>` diagnostics channels over Redis pub/sub and re-emits remote events onto the local bus, so `@OnDiagnostic` handlers fire across processes. Ships `createDiagnosticsRedisRelay(options)` and a global `DiagnosticsRedisModule`. Loop-safe (nodeId echo suppression + re-emit guard); coded against a minimal `RedisLike` interface (ioredis satisfies it). The diagnostics core stays in-process and untouched.
