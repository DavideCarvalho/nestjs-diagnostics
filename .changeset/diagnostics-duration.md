---
"@dudousxd/nestjs-diagnostics": minor
"@dudousxd/nestjs-diagnostics-telescope": minor
---

Diagnostics events can carry an optional `durationMs`. `emit(lib, event, payload, { durationMs })` stamps a wall-clock duration onto the envelope, and the generic Telescope watcher forwards it to the recorded entry's `durationMs`. This lets an observer (e.g. the Telescope OTel exporter) turn an `aviary:<lib>:<event>` stream into a **duration histogram** (p95/p99) instead of only a counter — so latency metrics can move onto the diagnostics→telescope path without losing their distribution.
