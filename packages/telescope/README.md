# @dudousxd/nestjs-diagnostics-telescope

A [nestjs-telescope](https://www.npmjs.com/package/@dudousxd/nestjs-telescope)
extension for [`@dudousxd/nestjs-diagnostics`](https://www.npmjs.com/package/@dudousxd/nestjs-diagnostics).
ONE generic watcher records **every** `aviary:<lib>:<event>` diagnostics event —
from any `@dudousxd/nestjs-*` library — as a `diagnostic` entry in the Telescope
dashboard. No per-library watcher needed.

## Install

```sh
pnpm add @dudousxd/nestjs-diagnostics-telescope
# peers: @dudousxd/nestjs-telescope, plus @dudousxd/nestjs-diagnostics on the producers
```

## Usage

```ts
import { TelescopeModule } from '@dudousxd/nestjs-telescope';
import { nestjsDiagnosticsTelescope } from '@dudousxd/nestjs-diagnostics-telescope';

TelescopeModule.forRoot({
  extensions: [nestjsDiagnosticsTelescope()],
});
```

Then anywhere a library emits — e.g. from a provider:

```ts
import { Injectable } from '@nestjs/common';
import { emit } from '@dudousxd/nestjs-diagnostics';

@Injectable()
export class BillingService {
  async markInvoicePaid(invoiceId: string, amount: number) {
    emit('billing', 'invoice-paid', { invoiceId, amount });
  }
}
```

…a `diagnostic` entry lands in Telescope with `content` = the payload, the
envelope's `traceId`, and tags `lib:billing` / `event:invoice-paid`.

## How the generic watcher auto-subscribes

`node:diagnostics_channel` has no wildcard — you can only subscribe by exact
channel name. So on `register` the `DiagnosticWatcher`:

1. subscribes to every channel already in the diagnostics registry
   (`registeredChannels()`), and
2. registers an `onChannelRegistered` callback, so any channel that appears later
   (a library's first `emit('newlib', …)`) is subscribed to automatically.

Subscribing also flips each producer's `channel.hasSubscribers` to `true`, which
is exactly what makes `emit()` start building and publishing envelopes (zero
overhead when nobody is listening).

## What it contributes

| Hook | Contribution |
| --- | --- |
| `watchers` | one `DiagnosticWatcher` covering all channels (current + future) |
| `entryTypes` | the navigable `diagnostic` type (sky dot) |
| `dashboards` | a "Diagnostics" page — busiest `lib:event` pairs + a recent-events table |
| `dataProviders` | `diagnostics.topEvents`, `diagnostics.recentEvents` |

## License

MIT
