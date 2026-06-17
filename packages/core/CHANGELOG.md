# @dudousxd/nestjs-diagnostics

## 0.2.1

### Patch Changes

- [#2](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/2) [`620c4bc`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/620c4bc08ce61f7059a2dd6ce2cdc19f2d5388a5) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Harden the cross-copy state to process-global singletons (keyed by `Symbol.for`
  on `globalThis`):

  - the channel **registry** (`registeredChannels` / `onChannelRegistered`), so the
    generic Telescope watcher discovers every emitted channel; and
  - the **context accessor** (`setContextAccessor` / `resolveTraceId`), so a `traceId`
    registered through one copy is visible to `emit()` in another.

  This matters when more than one physical copy of the package is loaded — divergent
  version ranges that pnpm cannot dedupe into a single instance. The
  `node:diagnostics_channel` objects were already process-global; this makes their
  discovery registry and the trace accessor equally global. No API change.

## 0.2.0

### Minor Changes

- [`fce932d`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/fce932df74ba25d47d9b41b3dc03b61674bd976f) - Initial release.

  `@dudousxd/nestjs-diagnostics` — a standard convention for `@dudousxd/nestjs-*`
  libraries to emit observability events over `node:diagnostics_channel`. Channels
  are named `aviary:<lib>:<event>`; `emit(lib, event, payload, opts?)` builds a
  `DiagnosticEvent` envelope (`ts`, `lib`, `event`, optional `traceId`, `payload`)
  and publishes only when the channel has subscribers. A process-wide registry
  (`registeredChannels()` + `onChannelRegistered()`) makes every channel
  discoverable, since `diagnostics_channel` has no wildcard subscription. An
  optional context accessor (`setContextAccessor`) auto-fills `traceId`.

  `@dudousxd/nestjs-diagnostics-telescope` — a `nestjs-telescope` extension whose
  single generic `DiagnosticWatcher` subscribes to every registered channel
  (current + future) and records each event as a `diagnostic` entry, with a
  "Diagnostics" dashboard page.
