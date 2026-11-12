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

## First-party `nestjs:*` channels

The official NestJS packages publish their own events on
`diagnostics_channel` with the convention `nestjs:<lib>:<type>`: a raw
payload, with no envelope and no traceId (see
[docs.nestjs.com](https://docs.nestjs.com)). **`nestjs:*` is the first-party
convention, and Aviary never publishes on it.** `aviary:*` is only for what the
official packages don't emit.

`subscribeOfficial` lets one consumer record both. It wraps each official
payload in the Aviary envelope, with `traceId` taken from the context accessor
and `source: 'nestjs'`:

```ts
import { subscribeOfficial } from '@dudousxd/nestjs-diagnostics';

const off = subscribeOfficial('resilience', ['retry', 'circuit-open'], (event, channel) => {
  // event: { v, ts, lib: 'resilience', event: 'retry', traceId, payload, source: 'nestjs' }
});
subscribeOfficial('authentication', 'all', record);
off();
```

The channel lists are exported per lib in one file, pinned to the official
versions they were verified against (`OFFICIAL_PACKAGE_VERSIONS`). A test
re-reads the installed packages and fails if a channel is added, renamed or
removed.

| Lib | Constant | Channels |
| --- | --- | --- |
| `@nestjs/resilience` 0.0.3 | `NESTJS_RESILIENCE_CHANNELS` | 9 |
| `@nestjs/workflows` 0.0.5 | `NESTJS_WORKFLOWS_CHANNELS` | 19 |
| `@nestjs/authentication` 0.1.5 | `NESTJS_AUTHENTICATION_CHANNELS` | 13 |
| `@nestjs/authorization` 0.1.3 | `NESTJS_AUTHORIZATION_CHANNELS` | 1 (`denied`) |
| `@nestjs/mail` 0.0.2 | `NESTJS_MAIL_CHANNELS` | 2 (`sent`, `failed`) |

These channels are not added to the `aviary:*` registry
(`registeredChannels`/`onChannelRegistered`). Their lists are fixed, so subscribe
to them explicitly.

## Recent events

`DiagnosticsModule` keeps the last events of the process (`aviary:*` events,
`trace()` span phases and `nestjs:*` events) in a fixed-size ring, with
secret-looking keys redacted and payloads cut to 2 KB. It is on unless
`NODE_ENV` is `'production'`; `recent: true | { size } | false` overrides that.

```ts
DiagnosticsModule.forRoot({ recent: { size: 1000 } });

// inject DiagnosticsRecentEvents, or anywhere:
import { recentEvents } from '@dudousxd/nestjs-diagnostics';
recentEvents({ lib: 'durable', event: /run\.failed/, traceId: 'req-42', limit: 50 });
```

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
| `subscribeOfficial(lib, types \| 'all', fn)` | Subscribe to first-party `nestjs:<lib>:<type>` channels, each payload wrapped in the envelope (+ `source: 'nestjs'`). Returns an unsubscribe. |
| `OFFICIAL_CHANNELS`, `NESTJS_*_CHANNELS`, `OFFICIAL_PACKAGE_VERSIONS`, `officialChannelNames()` | The pinned first-party channel lists. |
| `recentEvents(filter?)` | The newest buffered events (newest first), `[]` when the buffer is off. |
| `startRecentEvents(size?)`, `stopRecentEvents()`, `recentEventsBuffer()` | Run the recent-events buffer without `DiagnosticsModule`. |
| `DiagnosticEvent`, `EmitOptions`, `ContextAccessor`, `OfficialDiagnosticEvent` | Types. |

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

`event` also takes a `RegExp`. Each listener has a stable id, `<ClassName>#<method>`.

### Across processes: transports and `role`

Pick a `default` transport to run listeners across processes:

```ts
import { DiagnosticsModule, transports } from '@dudousxd/nestjs-diagnostics/nestjs';

DiagnosticsModule.forRoot({
  role: 'api', // 'all' (default) | 'api' | 'worker'
  default: 'queue',
  transports: {
    redis: transports.redis({ pub: redis, sub: redis.duplicate() }), // broadcast, best-effort
    queue: transports.queue({ connection: { host: 'localhost', port: 6379 } }), // BullMQ, retried
    durable: transports.durable({ retries: 5 }), // durable runs (@dudousxd/nestjs-durable-diagnostics)
  },
});
```

| transport | where the listener runs | lost if the process dies? | if the handler throws |
|---|---|---|---|
| none (local) | in the emitting process | yes | logged, dropped |
| `redis` | in every process (broadcast) | yes | logged, dropped |
| `queue` | in one worker | no | BullMQ retries the job (at-least-once) |
| `durable` | in one durable worker | no | durable retries with backoff; idempotent per event id |

See the [Listeners and transports](https://davidecarvalho.github.io/aviary/docs/diagnostics/listeners) docs.

## License

MIT
