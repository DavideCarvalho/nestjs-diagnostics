---
"@dudousxd/nestjs-diagnostics-redis": minor
---

Add `DiagnosticsRedisModule.forRootAsync({ imports?, inject?, useFactory })` so the relay's `pub`/`sub` ioredis clients can come from DI instead of a top-level `new Redis(...)`. `forRoot` still works for pre-built connections.
