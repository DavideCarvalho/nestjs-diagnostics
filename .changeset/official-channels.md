---
"@dudousxd/nestjs-diagnostics": minor
---

Add `subscribeOfficial(lib, types | 'all', fn)`, which subscribes to the first-party `nestjs:<lib>:<type>` channels (`@nestjs/resilience`, `workflows`, `authentication`, `authorization`, `mail`) and wraps each raw payload in the Aviary envelope, with `traceId` from the context accessor and `source: 'nestjs'`. The channel lists are exported per lib (`NESTJS_*_CHANNELS`, `OFFICIAL_CHANNELS`), pinned to `OFFICIAL_PACKAGE_VERSIONS`, and guarded by a drift test. Aviary never publishes on `nestjs:*`.
