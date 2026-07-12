# @dudousxd/nestjs-diagnostics-telescope

## 0.7.0

### Minor Changes

- [`477612f`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/477612f737fe45fe41fab5c6d95216fecd25a670) - Span recording — the generic watcher now records `trace()` traffic, not just `emit()` points: for
  every registered `(lib, event)` pair it subscribes the three terminal span sub-channels
  (`end`/`asyncEnd`/`error`) and records ONE `diagnostic` entry per completed span (tagged
  `kind:span`), carrying `spanId`/`phase`/`result`-or-`error`, `durationMs`, `startedAt` derived as
  terminal-ts − duration (so waterfall containment nests correctly), and the envelope's `traceId`
  passed EXPLICITLY through `RecordInput.traceId` (telescope core 1.17+) — spans land in the TRACES
  tab's waterfall under their producer-chosen trace id. The premature async `end` marker (no `result`
  key) is filtered, so counts stay one-entry-per-operation, coherent with the OTel counters. Claims
  and `exclude` apply to span traffic identically. `start`/`asyncStart` are never subscribed — their
  envelopes aren't even built (subscriber-gated), keeping unobserved spans free.

  Requires `@dudousxd/nestjs-telescope` >= 1.17.0 (peer bumped).

## 0.6.0

### Minor Changes

- [`1568de4`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/1568de44f05770ad2559f7d6d4ea38d9d213d7e5) - Cross-lib dedup, no consumer config: lib-specific telescope watchers (nestjs-agent's,
  nestjs-media's) record their `aviary:<lib>:<event>` channels as first-class typed entries — and
  the generic bridge recorded them AGAIN as `diagnostic` entries unless the consumer hand-maintained
  an exclude list. Now the libs resolve it themselves:

  - core: `claimDiagnostics(lib, events)` registers `lib:event` keys in a process-global,
    refcounted claim registry (`Symbol.for('aviary:diagnostics:claims')` — the raw convention is
    documented so packages without this dependency can participate); returns a release fn.
    `isDiagnosticClaimed(lib, event)` reads it.
  - telescope: the generic watcher checks claims AT RECORD TIME (order-independent) and skips
    claimed keys by default. `recordClaimed: true` opts back in; `exclude` still exists — its job
    is muting noisy events (e.g. `media:upload.progress`), not dedup.

  Lib watchers claim in their own upcoming releases; until then behavior is unchanged (nothing
  claims → everything records, exactly as today).

### Patch Changes

- Updated dependencies [[`1568de4`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/1568de44f05770ad2559f7d6d4ea38d9d213d7e5)]:
  - @dudousxd/nestjs-diagnostics@0.7.0

## 0.5.1

### Patch Changes

- [`0f2d623`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/0f2d623cad8b367da2759ad1c4e0c031f62a5920) - Add `exclude` option to `nestjsDiagnosticsTelescope` — a list of `lib:event` keys (the exact label shown in the "Busiest events" panel, e.g. `media:upload.progress`) to skip recording. Mutes high-frequency diagnostics channels that would otherwise flood the Telescope timeline; the events stay live on their diagnostics channel for other subscribers (OTel, custom watchers).

## 0.5.0

### Minor Changes

- [#16](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/16) [`3183b6a`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/3183b6abbfc3d17f8b85bf62d783099983e2d063) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Enrich the Diagnostics dashboard: add an "Events captured" stat and a "By
  library" top-N, and give the Recent events table a time + duration column plus a
  deep-link from each event's trace id straight to the Telescope Traces page — so a
  diagnostic event jumps to the request it was emitted from. New `diagnostics.count`
  and `diagnostics.byLib` data providers back the additions.

### Patch Changes

- [#16](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/16) [`540ef8a`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/540ef8aca15c3c5070088cad1c7777862fc612b7) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Fix the Diagnostics dashboard rendering empty: the extension `name` was
  `nestjs-diagnostics`, but its dashboard id (`diagnostics.diagnostics`) and data
  providers (`diagnostics.*`) use the `diagnostics` namespace. Telescope's
  controller scopes each panel fetch to `/ext/<dashboard-prefix>/data/<provider>`
  and 404s unless the provider's owning extension name equals that prefix, so
  every panel failed with "Unknown data provider". The extension is now named
  `diagnostics` to match.

## 0.4.1

### Patch Changes

- [#14](https://github.com/DavideCarvalho/nestjs-diagnostics/pull/14) [`cced7fc`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/cced7fc843c84eaf7b51686321294355bf2dd346) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Ship TanStack Intent agent skills (SKILL.md) inside the package.

- Updated dependencies [[`cced7fc`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/cced7fc843c84eaf7b51686321294355bf2dd346)]:
  - @dudousxd/nestjs-diagnostics@0.6.1

## 0.4.0

### Minor Changes

- [`16bd3a5`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/16bd3a5ae975edb8e8b9b8ea59d52e7a9a0b470f) - Diagnostics events can carry an optional `durationMs`. `emit(lib, event, payload, { durationMs })` stamps a wall-clock duration onto the envelope, and the generic Telescope watcher forwards it to the recorded entry's `durationMs`. This lets an observer (e.g. the Telescope OTel exporter) turn an `aviary:<lib>:<event>` stream into a **duration histogram** (p95/p99) instead of only a counter — so latency metrics can move onto the diagnostics→telescope path without losing their distribution.

### Patch Changes

- Updated dependencies [[`16bd3a5`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/16bd3a5ae975edb8e8b9b8ea59d52e7a9a0b470f)]:
  - @dudousxd/nestjs-diagnostics@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`ade4cad`](https://github.com/DavideCarvalho/nestjs-diagnostics/commit/ade4cad4ce96dc1e8a83d136f7f15477cf3183fb)]:
  - @dudousxd/nestjs-diagnostics@0.5.0

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
