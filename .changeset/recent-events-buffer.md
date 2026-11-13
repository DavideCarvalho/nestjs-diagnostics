---
"@dudousxd/nestjs-diagnostics": minor
---

Add a recent-events buffer: a fixed-size in-process ring of the last diagnostics events (`aviary:*` events, `trace()` span phases and first-party `nestjs:*` events), with secret-looking keys redacted and payloads cut to 2 KB. `DiagnosticsModule` starts it unless `NODE_ENV` is `'production'`; `recent: true | { size } | false` overrides the default. Read it with the `DiagnosticsRecentEvents` provider or `recentEvents(filter)`.
