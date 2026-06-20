# @dudousxd/nestjs-diagnostics

## 0.6.0

### Minor Changes

- [`16bd3a5`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/16bd3a5ae975edb8e8b9b8ea59d52e7a9a0b470f) - Diagnostics events can carry an optional `durationMs`. `emit(lib, event, payload, { durationMs })` stamps a wall-clock duration onto the envelope, and the generic Telescope watcher forwards it to the recorded entry's `durationMs`. This lets an observer (e.g. the Telescope OTel exporter) turn an `aviary:<lib>:<event>` stream into a **duration histogram** (p95/p99) instead of only a counter — so latency metrics can move onto the diagnostics→telescope path without losing their distribution.

## 0.5.0

### Minor Changes

- [`ade4cad`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/ade4cad4ce96dc1e8a83d136f7f15477cf3183fb) - Add the "capabilities" half of the integration protocol, alongside the existing event transport:

  - `capability(lib, name)` — single canonical source for cross-lib DI token names (`@dudousxd/nestjs-<lib>:<name>` via `Symbol.for`), the mirror of `channelName`.
  - `CapabilityRegistry` (augmentable via declaration merging) + `CapabilityOf<TLib, TName>` — the typed registry mirroring `ChannelRegistry`/`PayloadOf`.
  - `InjectCapability(lib, name)` — optional, typed parameter injector equivalent to `@Optional() @Inject(capability(lib, name))`, removing hand-copied magic-string tokens between libraries.
  - `assertCapabilityNaming(lib, tokens)` — contract-test helper that turns token-naming drift into a failing test.

## 0.4.0

### Minor Changes

- [`5d035d1`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/5d035d11263b40b2af1aaa18c1ffc6f03ec66df3) - Add the `@dudousxd/nestjs-diagnostics/nestjs` subpath: `@OnDiagnostic(lib, event?)`,
  `DiagnosticsModule.forRoot()`, and a `DiscoveryService` explorer that subscribes
  diagnostics channels to provider methods for ergonomic, DI-friendly in-app
  reactions. `@nestjs/*` are optional peers; the main barrel stays
  framework-agnostic.

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

## 0.2.3

### Patch Changes

- [`a37a2cd`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/a37a2cd8320188fc158ff34645eddbedad1968cd) - perf: keep the emit envelope monomorphic on the hot path — build it with a stable key set (traceId always present) instead of a conditional spread, avoiding a throwaway intermediate object per emit (~30% faster envelope build).

## 0.2.2

### Patch Changes

- [#4](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/4) [`2d9b817`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/2d9b817158b058e0c6413acfa8c2b3acd3728a6a) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Make `emit()`/`getChannel()` ~11x cheaper on the hot path by memoizing the
  resolved channel per `(lib, event)` pair. Previously every call re-built the
  `aviary:<lib>:<event>` string, re-looked-up the node channel, and re-checked the
  registry — ~174 ns/op even when nobody was subscribed. Now the first call for a
  pair pays that cost and every subsequent call is two `Map.get`s returning the same
  channel object (~16 ns/op; the no-subscriber path allocates nothing). The
  consumer-side pattern of caching the channel and gating on `hasSubscribers` before
  calling `emit` (~4 ns/op) stays the cheapest and remains recommended.

  No API or behavior change: channel identity, registry discovery
  (`registeredChannels`/`onChannelRegistered`), `hasSubscribers` gating,
  `opts.traceId` precedence, and never-throw are all unchanged.

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
