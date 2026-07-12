---
'@dudousxd/nestjs-diagnostics-telescope': minor
---

Span recording — the generic watcher now records `trace()` traffic, not just `emit()` points: for
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
