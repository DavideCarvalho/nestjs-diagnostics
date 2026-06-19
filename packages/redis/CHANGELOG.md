# @dudousxd/nestjs-diagnostics-redis

## 0.1.0

### Minor Changes

- [`283755d`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/283755dfb78ca0b31ed37abfe56855dff93597a4) - Add `@dudousxd/nestjs-diagnostics-redis`: a consumer-side relay that forwards selected `aviary:<lib>:<event>` diagnostics channels over Redis pub/sub and re-emits remote events onto the local bus, so `@OnDiagnostic` handlers fire across processes. Ships `createDiagnosticsRedisRelay(options)` and a global `DiagnosticsRedisModule`. Loop-safe (nodeId echo suppression + re-emit guard); coded against a minimal `RedisLike` interface (ioredis satisfies it). The diagnostics core stays in-process and untouched.
