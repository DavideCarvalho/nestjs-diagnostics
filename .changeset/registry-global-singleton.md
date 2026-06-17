---
'@dudousxd/nestjs-diagnostics': patch
---

Harden the cross-copy state to process-global singletons (keyed by `Symbol.for`
on `globalThis`):

- the channel **registry** (`registeredChannels` / `onChannelRegistered`), so the
  generic Telescope watcher discovers every emitted channel; and
- the **context accessor** (`setContextAccessor` / `resolveTraceId`), so a `traceId`
  registered through one copy is visible to `emit()` in another.

This matters when more than one physical copy of the package is loaded — divergent
version ranges that pnpm cannot dedupe into a single instance. The
`node:diagnostics_channel` objects were already process-global; this makes their
discovery registry and the trace accessor equally global. No API change.
