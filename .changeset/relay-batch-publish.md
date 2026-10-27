---
"@dudousxd/nestjs-diagnostics-redis": patch
---

Forward relayed events off the emitter's call stack. `emit()` no longer serializes and publishes to Redis synchronously: selected events are queued and, once per event loop turn, sent in emit order as a single pipeline (one Redis message per event, same wire format). Queued events are published when the relay is torn down.
