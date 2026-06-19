# @dudousxd/nestjs-diagnostics-telescope

## 0.3.1

### Patch Changes

- Updated dependencies [[`5d035d1`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/5d035d11263b40b2af1aaa18c1ffc6f03ec66df3)]:
  - @dudousxd/nestjs-diagnostics@0.4.0

## 0.3.0

### Minor Changes

- [#7](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/7) [`a78672e`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/a78672ef871610df13fb3cb875d15bc993c564ad) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - feat: ecosystem improvements across the diagnostics core and Telescope watcher.

  - **Envelope schema version (`v`):** every emitted envelope now carries an explicit schema-version field (`v`) so recorders and watchers can evolve the payload shape over time and detect/route by version. The Telescope watcher reads `v` when recording entries.
  - **Per-emit sampling hook:** emit accepts an optional per-emit sampling decision, letting callers cheaply drop a fraction of events at the emit site (before payload work is done) without disabling a channel wholesale.
  - **`tracingChannel()` + `trace()` helper:** a span-like wrapper over `node:diagnostics_channel`'s tracing-channel semantics that pairs `start`/`end`/`asyncStart`/`asyncEnd`/`error` events for a single logical operation, so a synchronous block or a promise can be traced with correct begin/finish/error correlation. The `trace()` helper wraps a function (sync or async) and publishes the matched lifecycle events automatically, including the `error` channel on throw/reject.
  - **Typed channel registry:** the channel registry is now generic over a compile-time payload-type map, so `channel(name)` and the corresponding publish/subscribe surfaces are typed to the registered payload for that channel name — catching mismatched payloads at compile time while staying erased at runtime.
  - **Packaging hygiene:** the core package declares a conservative `sideEffects` allowlist (rather than `false`) that preserves the module-level `globalThis` / `Symbol.for` registry and context-accessor registration so a bundler can never tree-shake the cross-copy-stable global state away; pure modules remain tree-shakeable.

  Also includes a `LICENSE` file at the repo root.

### Patch Changes

- [#7](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/7) [`a78672e`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/a78672ef871610df13fb3cb875d15bc993c564ad) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - chore: packaging hygiene — declare `sideEffects` for safe tree-shaking.

  The core package now declares `sideEffects` as an explicit allowlist of the modules that register process-global state at import time (the cross-copy-stable channel registry and context accessor on `globalThis` via `Symbol.for`, plus the reset hooks): `registry`, `context-accessor`, `channel`, and `trace`. It is deliberately **not** `false`, so a bundler can never tree-shake those global registrations away and break cross-copy registry stability; pure modules stay tree-shakeable.

  The telescope package declares `sideEffects: false` — it has no module-level side effects (the watcher subscribes to channels only at runtime, inside `register()`), so consumers get full tree-shaking.

  No runtime behavior changes; the `exports`/`types` maps already resolve correctly under NodeNext.

- Updated dependencies [[`a78672e`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/a78672ef871610df13fb3cb875d15bc993c564ad), [`a78672e`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/a78672ef871610df13fb3cb875d15bc993c564ad)]:
  - @dudousxd/nestjs-diagnostics@0.3.0

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

### Patch Changes

- Updated dependencies [[`fce932d`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/fce932df74ba25d47d9b41b3dc03b61674bd976f)]:
  - @dudousxd/nestjs-diagnostics@0.2.0
