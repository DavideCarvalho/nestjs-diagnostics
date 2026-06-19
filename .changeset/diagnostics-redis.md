---
"@dudousxd/nestjs-diagnostics-redis": minor
---

Add `@dudousxd/nestjs-diagnostics-redis`: a consumer-side relay that forwards selected `aviary:<lib>:<event>` diagnostics channels over Redis pub/sub and re-emits remote events onto the local bus, so `@OnDiagnostic` handlers fire across processes. Ships `createDiagnosticsRedisRelay(options)` and a global `DiagnosticsRedisModule`. Loop-safe (nodeId echo suppression + re-emit guard); coded against a minimal `RedisLike` interface (ioredis satisfies it). The diagnostics core stays in-process and untouched.
