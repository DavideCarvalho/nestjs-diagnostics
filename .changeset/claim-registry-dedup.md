---
'@dudousxd/nestjs-diagnostics': minor
'@dudousxd/nestjs-diagnostics-telescope': minor
---

Cross-lib dedup, no consumer config: lib-specific telescope watchers (nestjs-agent's,
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
