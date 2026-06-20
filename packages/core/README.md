# @dudousxd/nestjs-diagnostics

A tiny, standard convention for `@dudousxd/nestjs-*` libraries to emit
observability events over Node's built-in
[`diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html) — with
zero overhead when nobody is listening, and a single generic
[Telescope](https://www.npmjs.com/package/@dudousxd/nestjs-telescope) watcher
(`@dudousxd/nestjs-diagnostics-telescope`) that records them all.

## The convention

Every event flows over a channel named:

```
aviary:<lib>:<event>
```

- `aviary` is the fixed prefix for this family of libraries.
- `<lib>` identifies the emitting library, e.g. `billing`, `audit`, `jobs`.
- `<event>` is the event within that library, e.g. `invoice-paid`.

Each publish carries a `DiagnosticEvent` envelope:

```ts
interface DiagnosticEvent<TPayload = unknown> {
  ts: number; // Date.now() at publish time
  lib: string; // the <lib>
  event: string; // the <event>
  traceId?: string; // auto-filled from a context accessor when available
  payload: TPayload; // your library-defined data
}
```

## Emitting

Call `emit` from your provider wherever something interesting happens:

```ts
import { Injectable } from '@nestjs/common';
import { emit } from '@dudousxd/nestjs-diagnostics';

@Injectable()
export class BillingService {
  async markInvoicePaid(invoiceId: string, amount: number) {
    // … your domain logic …
    emit('billing', 'invoice-paid', { invoiceId, amount });
  }
}
```

`emit` builds and publishes the envelope **only when the channel has
subscribers** (`channel.hasSubscribers`), so a production process with no
observer attached pays essentially nothing per call. It never throws —
observability must not break the emitting code path.

Need an explicit trace id? Pass it in `opts` — e.g. inside a handler that
already holds a correlation id:

```ts
emit('billing', 'invoice-paid', payload, { traceId });
```

## Trace correlation

If your app uses `@dudousxd/nestjs-context` (an optional peer — never imported
here), register its accessor once and every `emit` will auto-fill `traceId`:

```ts
import { setContextAccessor, CONTEXT_ACCESSOR } from '@dudousxd/nestjs-diagnostics';

// e.g. in a Nest module after resolving the optional CONTEXT_ACCESSOR provider:
setContextAccessor(accessor);
```

`CONTEXT_ACCESSOR` is `Symbol.for('@dudousxd/nestjs-context:accessor')` — the
same token nestjs-context publishes under. Any object structurally matching the
`ContextAccessor` interface works.

## Observing (the registry)

`diagnostics_channel` has **no wildcard subscription** — you can only subscribe
to a channel by exact name. So this package keeps a registry of every
`aviary:<lib>:<event>` channel it has created or emitted on:

```ts
import { registeredChannels, onChannelRegistered } from '@dudousxd/nestjs-diagnostics';

// subscribe to all current channels…
for (const name of registeredChannels()) subscribe(name);
// …and any registered in the future
const off = onChannelRegistered(subscribe);
```

This is exactly how `@dudousxd/nestjs-diagnostics-telescope`'s single generic
watcher records every diagnostic event in the Telescope dashboard.

## API

| Export | Description |
| --- | --- |
| `emit(lib, event, payload, opts?)` | Build + publish a `DiagnosticEvent` on `aviary:<lib>:<event>` (only when subscribed). |
| `getChannel(lib, event)` | The memoized `diagnostics_channel` for a pair (also registers its name). |
| `channelName(lib, event)` | The `aviary:<lib>:<event>` string. |
| `CHANNEL_PREFIX` | `'aviary'`. |
| `registeredChannels()` | Snapshot of every registered channel name. |
| `onChannelRegistered(cb)` | Notified once per future channel registration; returns an unsubscribe. |
| `setContextAccessor(accessor \| null)` | Register the accessor `emit` reads `traceId` from. |
| `CONTEXT_ACCESSOR` | Shared DI token for the optional context accessor. |
| `DiagnosticEvent`, `EmitOptions`, `ContextAccessor` | Types. |

## Reacting to events in NestJS — `@OnDiagnostic`

The `@dudousxd/nestjs-diagnostics/nestjs` subpath adds an ergonomic way to react
to any `aviary:<lib>:<event>` in a NestJS app — no extra event library. Register
the module once, then decorate provider methods:

```ts
import { Module } from '@nestjs/common';
import { DiagnosticsModule } from '@dudousxd/nestjs-diagnostics/nestjs';

@Module({ imports: [DiagnosticsModule.forRoot()] })
export class AppModule {}
```

```ts
import { Injectable } from '@nestjs/common';
import { OnDiagnostic } from '@dudousxd/nestjs-diagnostics/nestjs';
import type { DiagnosticEvent } from '@dudousxd/nestjs-diagnostics';

@Injectable()
export class Reactions {
  @OnDiagnostic('resilience', 'circuit-opened') // one exact channel
  onCircuitOpen(e: DiagnosticEvent) { /* … */ }

  @OnDiagnostic('resilience')                   // every aviary:resilience:* channel
  onAnyResilience(e: DiagnosticEvent) { /* … */ }
}
```

A handler runs on the DI-resolved instance (injected dependencies work). A
handler that throws or rejects is logged and swallowed — it can never break the
code that emitted. `@nestjs/common` + `@nestjs/core` are optional peers; the main
barrel stays framework-agnostic.

## License

MIT
