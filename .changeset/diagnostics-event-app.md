---
"@dudousxd/nestjs-diagnostics": minor
"@dudousxd/nestjs-diagnostics-telescope": minor
---

App attribution on the event envelope: `emit(lib, event, payload, { app })` stamps `app` (the tenant app the event is about) on the `DiagnosticEvent`. It must match `[A-Za-z0-9_.-]{1,64}`; an invalid value is dropped (the event is still published) with a warning outside production (`AVIARY_DIAGNOSTICS_INVALID_APP`, once per value), and `emit` never throws. The Redis relay carries `app` unchanged and the recent-events buffer keeps it. The Telescope watcher tags such an entry `app:<name>` and records `app` in its content. Events without `app` are unchanged. Rule: the process that coordinates an action emits its event; when a control plane coordinates it for a tenant, only the control plane emits, with `app` set to the tenant.
