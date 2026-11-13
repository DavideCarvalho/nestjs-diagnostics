---
"@dudousxd/nestjs-diagnostics": minor
---

Add MCP dev tools: `DiagnosticsModule` registers `diagnostics_list_channels`, `diagnostics_list_listeners` and `diagnostics_list_recent_events` in the Aviary dev-tools slot (`Symbol.for('@dudousxd/aviary:dev-tools')`, created when absent). They register without an `authorize`, so the agent dev endpoint's `devTools.authorize` gates them (open outside production, denied in production without it); a hub that cannot gate console-less libs leaves them out. `devTools: false` turns them off. `transportKind(provider)` tells which built-in factory made a transport.
