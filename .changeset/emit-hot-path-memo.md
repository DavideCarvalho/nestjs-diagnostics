---
'@dudousxd/nestjs-diagnostics': patch
---

Make `emit()`/`getChannel()` ~11x cheaper on the hot path by memoizing the
resolved channel per `(lib, event)` pair. Previously every call re-built the
`aviary:<lib>:<event>` string, re-looked-up the node channel, and re-checked the
registry — ~174 ns/op even when nobody was subscribed. Now the first call for a
pair pays that cost and every subsequent call is two `Map.get`s returning the same
channel object (~16 ns/op; the no-subscriber path allocates nothing). The
consumer-side pattern of caching the channel and gating on `hasSubscribers` before
calling `emit` (~4 ns/op) stays the cheapest and remains recommended.

No API or behavior change: channel identity, registry discovery
(`registeredChannels`/`onChannelRegistered`), `hasSubscribers` gating,
`opts.traceId` precedence, and never-throw are all unchanged.
