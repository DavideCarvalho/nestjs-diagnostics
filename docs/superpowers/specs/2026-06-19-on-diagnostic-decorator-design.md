# `@OnDiagnostic` — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan
**Repo:** `nestjs-diagnostics` (new `./nestjs` subpath in `packages/core`)

## Goal

Give NestJS apps an ergonomic, DI-friendly way to **react** to any `aviary:<lib>:<event>` diagnostics event — `@OnDiagnostic('resilience', 'circuit-opened')` on a provider method — with **zero extra dependencies** beyond `@nestjs/*` (which every Nest app already has). This makes the per-library `@nestjs/event-emitter` mirror unnecessary across the whole ecosystem: one mechanism reacts to events from every lib already on the diagnostics bus (resilience, authz, context, inertia today; durable/notifications once onboarded).

## Background & constraints

- `@dudousxd/nestjs-diagnostics` core is **deliberately framework-agnostic** — no `@nestjs/*` dependency; its `dist/index.js` (emit / getChannel / registry) must stay importable by non-Nest consumers. The repo has only `core` + `telescope` packages and **no Nest module/decorator today**.
- Diagnostics primitives this builds on (all already exported from the main barrel):
  - `channelName(lib, event)` → `aviary:<lib>:<event>` (`CHANNEL_PREFIX = 'aviary'`).
  - `getChannel(lib, event)` → the memoized Node `Channel`.
  - `registeredChannels(): string[]` and `onChannelRegistered(cb: (name) => void): () => void` — discovery of current + future channels (`node:diagnostics_channel` has no wildcard).
  - `DiagnosticEvent` envelope: `{ v?: number; ts: number; lib: string; event: string; traceId?: string; payload: unknown }`.
- **`diagnostics_channel.publish` is synchronous** — a subscriber that throws propagates into the emitter's call stack. Reactions must therefore be fully isolated (never throw, never reject into the producer).
- Build: `tsc` (NodeNext, `.js` import specifiers), Node ≥20, pnpm 9 + turbo. Mirror the existing package layout.

**Reference implementations:**
- `@dudousxd/nestjs-diagnostics/packages/telescope/src/diagnostic.watcher.ts` — the subscribe / `onChannelRegistered` / unsubscribe / never-throw (`safeRecord`) mechanics.
- `@dudousxd/nestjs-resilience/packages/core/src/nest/{explorer,decorators}.ts` — the `DiscoveryService` + `MetadataScanner` explorer and the `Reflect` metadata-accumulation decorator pattern.

## Decision: where it lives

A **second entry point** in the existing core package: **`@dudousxd/nestjs-diagnostics/nestjs`**, source under `packages/core/src/nestjs/`. The main barrel stays `@nestjs`-free; `@nestjs/common` + `@nestjs/core` (+ `reflect-metadata`) become **optional peers** (`peerDependenciesMeta`). Mirrors the resilience `/testing` subpath trick — heavy/coupled deps kept out of the main barrel.

## Package surface

`packages/core/package.json` — add the subpath export and optional peers:

```jsonc
"exports": {
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./nestjs": { "types": "./dist/nestjs/index.d.ts", "import": "./dist/nestjs/index.js" }
},
"peerDependencies": { "@nestjs/common": "^10 || ^11", "@nestjs/core": "^10 || ^11", "reflect-metadata": "^0.2" },
"peerDependenciesMeta": {
  "@nestjs/common": { "optional": true },
  "@nestjs/core": { "optional": true },
  "reflect-metadata": { "optional": true }
}
```

`tsc` already compiles all of `src/` → `dist/`, so `src/nestjs/*` lands at `dist/nestjs/*`; only the exports map and peers change. The main `src/index.ts` is **not** touched (no `@nestjs` import enters the main barrel).

## File structure

```
packages/core/src/nestjs/
├── index.ts                 # public subpath exports
├── on-diagnostic.decorator.ts   # @OnDiagnostic + ON_DIAGNOSTIC_META + meta type
├── diagnostics.explorer.ts      # DiscoveryService explorer: subscribe channels → methods
├── diagnostics.module.ts        # DiagnosticsModule.forRoot()
├── on-diagnostic.decorator.spec.ts
└── diagnostics.explorer.spec.ts
```

## Component 1 — `@OnDiagnostic` decorator

```ts
export const ON_DIAGNOSTIC_META = Symbol('diagnostics:on');

/** One subscription declared on a method. `event` undefined = all events of `lib`. */
export interface OnDiagnosticMeta {
  lib: string;
  event?: string;
}

export function OnDiagnostic(lib: string, event?: string): MethodDecorator {
  return (target, key) => {
    const existing: OnDiagnosticMeta[] = Reflect.getMetadata(ON_DIAGNOSTIC_META, target, key) ?? [];
    Reflect.defineMetadata(ON_DIAGNOSTIC_META, [...existing, { lib, ...(event !== undefined ? { event } : {}) }], target, key);
  };
}
```

- `@OnDiagnostic('resilience', 'circuit-opened')` → exact channel `aviary:resilience:circuit-opened`.
- `@OnDiagnostic('resilience')` → every `aviary:resilience:*` channel (current + future).
- Stacking is supported (multiple metas accumulate); one handler can bind several channels.

## Component 2 — `DiagnosticsExplorer`

Mirrors `ResilienceExplorer` but **subscribes** channels to methods instead of wrapping them.

```ts
@Injectable()
export class DiagnosticsExplorer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DiagnosticsExplorer');
  /** Every (channelName, listener) we attached, so shutdown detaches exactly. */
  private readonly subscriptions: Array<{ name: string; listener: (msg: unknown) => void }> = [];
  /** Library-prefix wildcards awaiting future channels. */
  private readonly wildcards: Array<{ prefix: string; invoke: (e: DiagnosticEvent) => void }> = [];
  private offChannelRegistered: (() => void) | null = null;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
  ) {}

  onApplicationBootstrap(): void { /* scan + subscribe (below) */ }
  onApplicationShutdown(): void { /* unsubscribe all + detach onChannelRegistered */ }
}
```

### Bootstrap algorithm

1. For every provider from `discovery.getProviders()` with an object `instance`, for every method name from `scanner.getAllMethodNames(proto)`, read `ON_DIAGNOSTIC_META`.
2. For each `{ lib, event }` meta, build `invoke = (e: DiagnosticEvent) => this.safeInvoke(instance, methodName, e)`.
3. **Exact** (`event` defined): `subscribe(channelName(lib, event), invoke)`.
4. **Wildcard** (`event` undefined): record `{ prefix: \`${CHANNEL_PREFIX}:${lib}:\`, invoke }` in `wildcards`; immediately `subscribe(name, invoke)` for every `name` in `registeredChannels()` that `startsWith` that prefix.
5. After scanning, attach **one** `onChannelRegistered((name) => for each wildcard whose prefix matches name: subscribe(name, wildcard.invoke))` and store its off-handle.

`subscribe(name, invoke)`:

```ts
const listener = (msg: unknown) => invoke(msg as DiagnosticEvent);
diagnostics_channel.channel(name).subscribe(listener);
this.subscriptions.push({ name, listener });
```

(Subscribing flips the channel's `hasSubscribers` → producers begin publishing; zero-cost while no handler is bound.)

### Never-throw isolation (the critical guarantee)

```ts
private safeInvoke(instance: Record<string, unknown>, methodName: string, event: DiagnosticEvent): void {
  try {
    const result = (instance[methodName] as (e: DiagnosticEvent) => unknown).call(instance, event);
    if (result != null && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).catch((err) => this.logError(methodName, err));
    }
  } catch (err) {
    this.logError(methodName, err); // NOT rethrown — a reaction must never break the emitter
  }
}
```

Synchronous throws are caught; async rejections are caught off the returned promise. The producing `emit()` can never be broken by a handler. (Publish cannot await, so async handlers are fire-and-forget by nature.)

### Shutdown

`onApplicationShutdown`: `this.offChannelRegistered?.()`; for each `{ name, listener }` → `diagnostics_channel.channel(name).unsubscribe(listener)`; clear both arrays.

## Component 3 — `DiagnosticsModule`

```ts
@Module({})
export class DiagnosticsModule {
  static forRoot(): DynamicModule {
    return {
      module: DiagnosticsModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [DiagnosticsExplorer],
    };
  }
}
```

Import once at the app root; `@OnDiagnostic` then works on any provider app-wide.

```ts
@Module({ imports: [DiagnosticsModule.forRoot()] })
export class AppModule {}
```

## Public exports (`src/nestjs/index.ts`)

```ts
export { OnDiagnostic, ON_DIAGNOSTIC_META } from './on-diagnostic.decorator.js';
export type { OnDiagnosticMeta } from './on-diagnostic.decorator.js';
export { DiagnosticsModule } from './diagnostics.module.js';
export { DiagnosticsExplorer } from './diagnostics.explorer.js';
```

The handler receives `DiagnosticEvent` (re-exported from the main barrel — consumers `import type { DiagnosticEvent } from '@dudousxd/nestjs-diagnostics'`).

## Testing

**`on-diagnostic.decorator.spec.ts`** (pure, no Nest):
- a single `@OnDiagnostic('resilience', 'circuit-opened')` records one exact meta;
- `@OnDiagnostic('resilience')` records a meta with no `event` (wildcard);
- two stacked decorators on one method accumulate both metas in order.

**`diagnostics.explorer.spec.ts`** (`@nestjs/testing` + the diagnostics `emit` / `resetRegistry`):
- a provider method `@OnDiagnostic('resilience', 'circuit-opened')` fires (with the full envelope) when `emit('resilience', 'circuit-opened', payload)` runs; the handler can use an injected dependency (DI works);
- **exact isolation**: that handler does **not** fire for `emit('resilience', 'failover', …)`;
- **lib wildcard**: `@OnDiagnostic('resilience')` fires for `circuit-opened` **and** for `failover` whose channel registers only at first emit (after bootstrap) — proving `onChannelRegistered` wiring;
- **cross-lib isolation**: `emit('authz', 'decision', …)` does not fire a `resilience` binding;
- **never-throw**: a handler that throws does not propagate out of `emit(...)` (the `emit` call returns normally); an async handler that rejects is swallowed (no unhandled rejection);
- **cleanup**: after `app.close()`, `emit(...)` no longer calls the handler.

Reset diagnostics state between tests (`resetRegistry()`), as the telescope watcher tests do.

## Out of scope (v1)

- **Global `@OnDiagnostic()`** (every lib, no filter) — that is a generic observer, the job of a Telescope-style watcher, not in-app reactions.
- **Typed payloads** via the existing `ChannelRegistry` declaration-merging (`@OnDiagnostic` could infer `event.payload`) — a future ergonomic upgrade; v1 is `payload: unknown`.
- **Cross-process delivery** (a transport adapter) — separate roadmap item; diagnostics stays in-process here.
- **Onboarding durable / notifications** to emit over diagnostics — separate per-library items that make more events reachable through this same decorator.
