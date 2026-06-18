---
"@dudousxd/nestjs-diagnostics": patch
"@dudousxd/nestjs-diagnostics-telescope": patch
---

chore: packaging hygiene — declare `sideEffects` for safe tree-shaking.

The core package now declares `sideEffects` as an explicit allowlist of the modules that register process-global state at import time (the cross-copy-stable channel registry and context accessor on `globalThis` via `Symbol.for`, plus the reset hooks): `registry`, `context-accessor`, `channel`, and `trace`. It is deliberately **not** `false`, so a bundler can never tree-shake those global registrations away and break cross-copy registry stability; pure modules stay tree-shakeable.

The telescope package declares `sideEffects: false` — it has no module-level side effects (the watcher subscribes to channels only at runtime, inside `register()`), so consumers get full tree-shaking.

No runtime behavior changes; the `exports`/`types` maps already resolve correctly under NodeNext.
