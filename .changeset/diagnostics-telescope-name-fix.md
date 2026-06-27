---
"@dudousxd/nestjs-diagnostics-telescope": patch
---

Fix the Diagnostics dashboard rendering empty: the extension `name` was
`nestjs-diagnostics`, but its dashboard id (`diagnostics.diagnostics`) and data
providers (`diagnostics.*`) use the `diagnostics` namespace. Telescope's
controller scopes each panel fetch to `/ext/<dashboard-prefix>/data/<provider>`
and 404s unless the provider's owning extension name equals that prefix, so
every panel failed with "Unknown data provider". The extension is now named
`diagnostics` to match.
