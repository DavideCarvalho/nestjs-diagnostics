---
"@dudousxd/nestjs-diagnostics-telescope": patch
---

Add `exclude` option to `nestjsDiagnosticsTelescope` — a list of `lib:event` keys (the exact label shown in the "Busiest events" panel, e.g. `media:upload.progress`) to skip recording. Mutes high-frequency diagnostics channels that would otherwise flood the Telescope timeline; the events stay live on their diagnostics channel for other subscribers (OTel, custom watchers).
