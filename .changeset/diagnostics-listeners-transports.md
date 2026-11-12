---
'@dudousxd/nestjs-diagnostics': minor
'@dudousxd/nestjs-diagnostics-redis': minor
---

Listeners with delivery transports and `role`.

- Every envelope from `emit` and `trace` carries a unique `id` (a UUID). Relays keep it, so the same event has the same `id` in every process.
- `@OnDiagnostic(lib, event?)` accepts a `RegExp` for `event`, and checks the handler's parameter against the `ChannelRegistry` payload for registered channels. Each listener has a stable id, `<ClassName>#<method>`; two listener classes with the same name fail the bootstrap.
- `DiagnosticsModule.forRoot({ default, transports, role, nodeId })` and `forRootAsync(...)` select how listeners run across processes, with the `transports` factory:
  - `transports.redis({ pub, sub })`: broadcast over Redis pub/sub, best-effort.
  - `transports.queue({ connection })`: one BullMQ job per `(listener, event)`, retried when the handler throws (optional peer `bullmq`).
  - `transports.durable(options)`: one durable run per `(listener, event)` through `@dudousxd/nestjs-durable-diagnostics/delivery`, imported only when selected; bootstrap fails with a clear message when it is missing or durable is not configured.
  With `queue` and `durable`, delivery happens once, from the emitting process.
- `role: 'all' | 'api' | 'worker'`: `'api'` emits and hands work to the transport but never consumes or runs listeners. `'api'`/`'worker'` without a `default` transport fail the bootstrap.
- The Redis relay now lives in `@dudousxd/nestjs-diagnostics` (`createDiagnosticsRedisRelay`); `@dudousxd/nestjs-diagnostics-redis` re-exports it. It takes `receive: false` for a publish-only relay (then `sub` is optional), and marks re-emitted copies (`isRelayed`).
