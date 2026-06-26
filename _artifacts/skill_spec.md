# Skill spec — nestjs-diagnostics (autonomous pass)

## Scope

Three public, client-facing packages, all covered:

| Package | Version | Skills |
| --- | --- | --- |
| `@dudousxd/nestjs-diagnostics` (core) | 0.6.0 | emit-diagnostics, trace-spans, observe-channels, react-with-on-diagnostic, capabilities |
| `@dudousxd/nestjs-diagnostics-redis` | 0.1.2 | redis-transport |
| `@dudousxd/nestjs-diagnostics-telescope` | 0.4.0 | telescope-watcher |

7 SKILL.md files. Flat structure (`packages/<pkg>/skills/<skill>/SKILL.md`), no
router skill, all type `core` — the per-package skill counts are small (5/1/1).

No package was excluded: the monorepo has exactly these three packages and every
one is publishable and consumer-facing (none `private`).

## Why these skills

The core package exposes four largely independent surfaces a consumer imports
separately — producing point events (`emit`), tracing spans (`trace`), building a
custom consumer off the registry (`registeredChannels`/`onChannelRegistered`),
and reacting in NestJS (`@OnDiagnostic`) — plus a distinct protocol half,
capabilities (`capability`/`InjectCapability`). Each became one focused skill so an
agent loads only the surface it needs. Redis and Telescope are one cohesive
surface each.

## Grounding

Every export, option, decorator, and snippet is grounded in this repo's source
(`packages/*/src/**`) or its READMEs. Real symbols used in Wrong/Correct pairs:
`emit`, `getChannel`, `channelName`, `CHANNEL_PREFIX`, `trace`, `tracingChannel`,
`traceChannelNames`, `registeredChannels`, `onChannelRegistered`, `resetRegistry`,
`setContextAccessor`, `CONTEXT_ACCESSOR`, `ContextAccessor`, `DiagnosticsModule`,
`OnDiagnostic`, `capability`, `InjectCapability`, `assertCapabilityNaming`,
`DiagnosticsRedisModule`, `createDiagnosticsRedisRelay`,
`nestjsDiagnosticsTelescope`, `DiagnosticWatcher`, `isDiagnosticEvent`,
`buildDiagnosticEntry`.

## Remaining gaps (what a maintainer interview would have answered)

- **Priority/severity ranking of failure modes.** The AI-agent failure modes were
  mined from source comments, READMEs, and the design specs in `docs/superpowers/`,
  not confirmed against real support tickets — `gh search issues` returned nothing
  accessible in this environment.
- **Sibling-library event catalogs.** Examples reference illustrative
  `lib:event` pairs (`durable:run.failed`, `resilience:circuit-opened`,
  `billing:invoice-paid`) drawn from the repo's own docs/READMEs; the authoritative
  event names live in those sibling repos, not here.
- **No in-repo tests** to mine for canonical real-world usage; snippets are built
  from public signatures plus README examples.
- **Production heuristics** (recommended `sample` rates, when to prefer `trace`
  over `emit`, Telescope entry retention, dashboard limit tuning) are undocumented
  in-repo and were intentionally omitted rather than invented.
- **Peer Telescope extension contract** (`TelescopeExtension`, `Watcher`,
  `DataProvider`, `DashboardSpec`, `TELESCOPE_STORAGE`) is treated as a stable
  imported API at `@dudousxd/nestjs-telescope@^1.9.0`; its version-specific shape
  was not independently verified beyond the imports used here.
