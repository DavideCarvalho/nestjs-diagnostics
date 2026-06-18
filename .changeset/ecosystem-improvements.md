---
"@dudousxd/nestjs-diagnostics": minor
"@dudousxd/nestjs-diagnostics-telescope": minor
---

feat: ecosystem improvements across the diagnostics core and Telescope watcher.

- **Envelope schema version (`v`):** every emitted envelope now carries an explicit schema-version field (`v`) so recorders and watchers can evolve the payload shape over time and detect/route by version. The Telescope watcher reads `v` when recording entries.
- **Per-emit sampling hook:** emit accepts an optional per-emit sampling decision, letting callers cheaply drop a fraction of events at the emit site (before payload work is done) without disabling a channel wholesale.
- **`tracingChannel()` + `trace()` helper:** a span-like wrapper over `node:diagnostics_channel`'s tracing-channel semantics that pairs `start`/`end`/`asyncStart`/`asyncEnd`/`error` events for a single logical operation, so a synchronous block or a promise can be traced with correct begin/finish/error correlation. The `trace()` helper wraps a function (sync or async) and publishes the matched lifecycle events automatically, including the `error` channel on throw/reject.
- **Typed channel registry:** the channel registry is now generic over a compile-time payload-type map, so `channel(name)` and the corresponding publish/subscribe surfaces are typed to the registered payload for that channel name — catching mismatched payloads at compile time while staying erased at runtime.
- **Packaging hygiene:** the core package declares a conservative `sideEffects` allowlist (rather than `false`) that preserves the module-level `globalThis` / `Symbol.for` registry and context-accessor registration so a bundler can never tree-shake the cross-copy-stable global state away; pure modules remain tree-shakeable.

Also includes a `LICENSE` file at the repo root.
