---
name: react-with-on-diagnostic
description: React to diagnostics events inside a NestJS app with @OnDiagnostic(lib, event?) from @dudousxd/nestjs-diagnostics/nestjs, wired by DiagnosticsModule.forRoot()/forRootAsync({ default, transports, role, nodeId }). Decorate provider methods to handle one exact aviary:<lib>:<event> channel, a RegExp match, or every aviary:<lib>:* channel (current and future). The handler parameter is checked against the ChannelRegistry payload for registered channels; each listener has a stable <ClassName>#<method> id. Handlers run on the DI-resolved instance; without a delivering transport sync throws and async rejections are logged and swallowed, while queue/durable transports propagate the handler error for retry with delivery once from the emitting process. role 'api' never consumes or runs listeners.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-diagnostics"
  library_version: 0.6.0
  framework: nestjs
---

# React to events with @OnDiagnostic

The `@dudousxd/nestjs-diagnostics/nestjs` subpath adds an ergonomic way to react
to any `aviary:<lib>:<event>` event in a NestJS app — no extra event library.
Register the module once, then decorate provider methods.

## Setup

```bash
pnpm add @dudousxd/nestjs-diagnostics
# requires @nestjs/common, @nestjs/core, reflect-metadata (optional peers)
```

Register the module at the app root (it is `global`, imports `DiscoveryModule`):

```ts
import { Module } from '@nestjs/common';
import { DiagnosticsModule } from '@dudousxd/nestjs-diagnostics/nestjs';

@Module({ imports: [DiagnosticsModule.forRoot()] })
export class AppModule {}
```

Then decorate provider methods:

```ts
import { Injectable } from '@nestjs/common';
import { OnDiagnostic } from '@dudousxd/nestjs-diagnostics/nestjs';
import type { DiagnosticEvent } from '@dudousxd/nestjs-diagnostics';

@Injectable()
export class Reactions {
  @OnDiagnostic('resilience', 'circuit-opened') // one exact channel
  onCircuitOpen(e: DiagnosticEvent) { /* … */ }

  @OnDiagnostic('durable', /^run\./)            // every event of the lib whose name matches
  onRun(e: DiagnosticEvent) { /* … */ }

  @OnDiagnostic('resilience')                   // every aviary:resilience:* channel
  onAnyResilience(e: DiagnosticEvent) { /* … */ }
}
```

For a channel declared in the `ChannelRegistry`, the handler's parameter is
checked against the declared payload (see `DiagnosticEventOf`); untyped
channels accept any annotation. Each listener has a stable id,
`<ClassName>#<method>`; two listener classes with the same name fail the
bootstrap. To run listeners across processes, pass
`{ default, transports, role, nodeId }` to `forRoot()` (or `forRootAsync()`):
`transports.redis()`, `transports.queue()`, or `transports.durable()` select
the delivery, and `role: 'api'` emits and hands work to the transport but
never consumes or runs listeners (`'api'`/`'worker'` without a `default`
transport fail the bootstrap).

Source: `packages/core/src/nestjs/diagnostics.module.ts`,
`packages/core/src/nestjs/on-diagnostic.decorator.ts`,
`packages/core/src/nestjs/diagnostics.explorer.ts`.

## Core patterns

### 1. Exact channel, RegExp match, or library wildcard

- `@OnDiagnostic('resilience', 'circuit-opened')` subscribes to the exact
  `aviary:resilience:circuit-opened` channel.
- `@OnDiagnostic('durable', /^run\./)` subscribes to every
  `aviary:durable:*` channel whose event name matches the `RegExp`.
- `@OnDiagnostic('resilience')` (no `event`) subscribes to **every**
  `aviary:resilience:*` channel — both those already registered at bootstrap and
  any that appear later (a library's first `emit('resilience', 'newevent', …)`).

The explorer scans providers on `onApplicationBootstrap`, then keeps an
`onChannelRegistered` callback alive so future wildcard channels are subscribed
automatically.

Source: `packages/core/src/nestjs/diagnostics.explorer.ts` (`onApplicationBootstrap`).

Each discovered method gets a stable listener id, `<ClassName>#<method>`,
which delivering transports (`queue`, `durable`) use to route work; keep it
stable while deliveries may be pending. Two listener classes with the same
name fail the bootstrap. `role: 'api'` never consumes or runs listeners —
it emits and hands work to the transport.

### 2. Handlers run on the DI-resolved instance

The decorated method is invoked on the real provider instance, so injected
dependencies are available:

```ts
@Injectable()
export class AlertReactions {
  constructor(private readonly notifier: Notifier) {}

  @OnDiagnostic('billing', 'invoice-paid')
  async onPaid(e: DiagnosticEvent<{ invoiceId: string; amount: number }>) {
    await this.notifier.send(`Paid ${e.payload.invoiceId}`);
  }
}
```

Source: `packages/core/src/nestjs/diagnostics.explorer.ts` (`invoke` calls `fn.call(instance, event)`).

### 3. Never-throw isolation without a delivering transport

`diagnostics_channel.publish` is **synchronous**, so a subscriber that throws
would propagate into the emitter's call stack. Without a delivering transport,
the explorer's `invoke` path
catches synchronous throws and attaches a `.catch` to rejected promises, logging
both — a reaction can never break the `emit()` that triggered it. Async handlers
are therefore fire-and-forget (publish cannot await). With a delivering
transport (`queue`, `durable`), delivery happens once, from the emitting
process, and the handler's error rejects `invoke` so the transport can retry
instead of being swallowed.

Source: `packages/core/src/nestjs/diagnostics.explorer.ts` (`invoke`, `onEvent`, `deliver`).

## Common mistakes

### Using @OnDiagnostic without importing DiagnosticsModule.forRoot()

```ts
// Wrong — decorator metadata is set, but nothing scans/subscribes it.
@Module({})
export class AppModule {}
```

```ts
// Correct — forRoot() registers the explorer that wires every @OnDiagnostic.
@Module({ imports: [DiagnosticsModule.forRoot()] })
export class AppModule {}
```

`@OnDiagnostic` only records metadata; `DiagnosticsExplorer` (provided by
`forRoot()`) is what discovers decorated methods and subscribes the channels at
bootstrap.
Source: `packages/core/src/nestjs/diagnostics.module.ts` (`forRoot` provides `DiagnosticsExplorer`).

### Decorating a method on a non-provider class

```ts
// Wrong — a plain class Nest never instantiates is never scanned.
class Reactions {
  @OnDiagnostic('billing', 'invoice-paid') onPaid(e: DiagnosticEvent) {}
}
```

```ts
// Correct — @Injectable() and registered in a module's providers.
@Injectable()
export class Reactions {
  @OnDiagnostic('billing', 'invoice-paid') onPaid(e: DiagnosticEvent) {}
}
```

The explorer iterates `discovery.getProviders()`; only DI-managed provider
instances are scanned for `@OnDiagnostic` metadata.
Source: `packages/core/src/nestjs/diagnostics.explorer.ts` (`discovery.getProviders()`).

### Throwing in a handler expecting the framework to retry

```ts
// Wrong — assuming a throw bubbles up or triggers a retry (without a delivering transport it will NOT — it is logged and swallowed).
@OnDiagnostic('billing', 'invoice-paid')
onPaid(e: DiagnosticEvent) {
  throw new Error('will be retried'); // only retried with transports.queue()/durable()
}
```

```ts
// Correct — handle failures inside the reaction when running without a delivering transport; it is fire-and-forget.
@OnDiagnostic('billing', 'invoice-paid')
async onPaid(e: DiagnosticEvent) {
  try { await this.work(e); } catch (err) { this.logger.warn(err); }
}
```

Without a delivering transport, the explorer swallows throws/rejections by design, so emission stays safe — there
is no delivery guarantee, retry, or replay. With `transports.queue()` or
`transports.durable()`, the handler error propagates to the transport and is
retried (delivery happens once, from the emitting process).
Source: `packages/core/src/nestjs/diagnostics.explorer.ts` (`invoke`, `onEvent`).
