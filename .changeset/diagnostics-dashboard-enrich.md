---
"@dudousxd/nestjs-diagnostics-telescope": minor
---

Enrich the Diagnostics dashboard: add an "Events captured" stat and a "By
library" top-N, and give the Recent events table a time + duration column plus a
deep-link from each event's trace id straight to the Telescope Traces page — so a
diagnostic event jumps to the request it was emitted from. New `diagnostics.count`
and `diagnostics.byLib` data providers back the additions.
