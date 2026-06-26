# @dudousxd/nestjs-diagnostics-redis

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
