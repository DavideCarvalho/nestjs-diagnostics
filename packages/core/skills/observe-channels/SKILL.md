---
name: observe-channels
description: Build a custom consumer of @dudousxd/nestjs-diagnostics events (OpenTelemetry span, APM, logger, test assertion) using the channel registry. Covers registeredChannels(), onChannelRegistered(cb), getChannel(lib, event), channelName(lib, event) and CHANNEL_PREFIX. Explains why node:diagnostics_channel has no wildcard, the subscribe-current-plus-future pattern, that subscribing flips hasSubscribers so producers start emitting, and resetRegistry for tests.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-diagnostics"
  library_version: 0.6.0
  framework: nestjs
---

# Observe channels with the registry

Anyone can consume `aviary:<lib>:<event>` events — Telescope is just one consumer,
and so is an OpenTelemetry span exporter, an APM bridge, a logger, or a test
assertion. This skill covers the **low-level registry** you use to build your own
generic consumer. (For NestJS provider methods, prefer `@OnDiagnostic`; for
Telescope, use the telescope extension.)

## Setup

```bash
pnpm add @dudousxd/nestjs-diagnostics
```

`node:diagnostics_channel` has **no wildcard subscription** — you can only
subscribe by exact channel name. So this package keeps a process-global registry
of every `aviary:<lib>:<event>` channel it has created. A generic consumer
subscribes to the current set and any registered later:

```ts
import diagnostics_channel from 'node:diagnostics_channel';
import {
  registeredChannels,
  onChannelRegistered,
  type DiagnosticEvent,
} from '@dudousxd/nestjs-diagnostics';

function record(name: string) {
  diagnostics_channel.channel(name).subscribe((msg) => {
    const e = msg as DiagnosticEvent;
    console.log(`[${e.lib}:${e.event}]`, e.traceId, e.payload);
  });
}

// 1. subscribe to all current channels…
for (const name of registeredChannels()) record(name);
// 2. …and any registered in the future
const off = onChannelRegistered(record);
```

Source: `packages/core/src/registry.ts`, `packages/core/src/channel.ts` (`channelName`, `getChannel`).

## Core patterns

### 1. Current + future, never replay

`onChannelRegistered(cb)` fires once per channel registered **after** the call;
it does NOT replay existing channels. Always pair it with `registeredChannels()`
to cover both — exactly how the Telescope `DiagnosticWatcher` and the Redis relay
auto-subscribe. The returned function unsubscribes the listener.

```ts
const off = onChannelRegistered(record);
// later, on shutdown:
off();
```

Source: `packages/core/src/registry.ts` (`registeredChannels`, `onChannelRegistered`).

### 2. Subscribing turns producers on

A channel is only registered the first time `getChannel`/`emit`/`trace` touches a
`(lib, event)` pair. Subscribing to a channel also flips its `hasSubscribers` to
`true`, which is precisely what makes `emit()` start building and publishing
envelopes (zero overhead when nobody listens). So your consumer existing is what
makes producers pay the cost.

```ts
import { getChannel } from '@dudousxd/nestjs-diagnostics';
// channelName(lib, event) === `aviary:${lib}:${event}` (CHANNEL_PREFIX === 'aviary')
const ch = getChannel('billing', 'invoice-paid'); // registers the name + memoizes the Channel
```

Source: `packages/core/src/channel.ts` (`getChannel`, `emit` `hasSubscribers` gate),
`packages/core/src/registry.ts` (`registerChannel`).

### 3. Resetting the registry in tests

`resetRegistry()` is test-only: it forgets every registered channel and listener
(and clears the internal channel memo caches via reset hooks) so a suite can
assert registration in isolation. Do not call it in production code.

```ts
import { resetRegistry, registeredChannels, emit } from '@dudousxd/nestjs-diagnostics';

beforeEach(() => resetRegistry());

it('registers the channel on first emit', () => {
  emit('billing', 'invoice-paid', { invoiceId: 'x', amount: 1 });
  expect(registeredChannels()).toContain('aviary:billing:invoice-paid');
});
```

Source: `packages/core/src/registry.ts` (`resetRegistry`, `onRegistryReset`).

## Common mistakes

### Using onChannelRegistered alone and missing existing channels

```ts
// Wrong — channels emitted before this line are never subscribed.
onChannelRegistered(record);
```

```ts
// Correct — replay the current set, then listen for future ones.
for (const name of registeredChannels()) record(name);
const off = onChannelRegistered(record);
```

`onChannelRegistered` only fires for registrations that happen *after* it is
called; it deliberately does not replay history.
Source: `packages/core/src/registry.ts` (`onChannelRegistered` doc).

### Trying to subscribe with a wildcard channel name

```ts
// Wrong — node:diagnostics_channel has no wildcard; this is a literal name.
import diagnostics_channel from 'node:diagnostics_channel';
diagnostics_channel.channel('aviary:billing:*').subscribe(record); // never fires
```

```ts
// Correct — enumerate names from the registry and subscribe to each.
import { registeredChannels, onChannelRegistered } from '@dudousxd/nestjs-diagnostics';
for (const name of registeredChannels()) record(name);
const off = onChannelRegistered(record);
```

There is no pattern subscription in `diagnostics_channel`; the registry exists
precisely to enumerate exact names for you.
Source: `packages/core/src/registry.ts` (module doc), `packages/core/src/channel.ts`.

### Throwing from a subscriber listener

```ts
// Wrong — publish() is synchronous; a throw lands in the producer's emit() call.
diagnostics_channel.channel(name).subscribe((msg) => {
  JSON.parse((msg as any).payload.raw); // may throw → breaks the emitter
});
```

```ts
// Correct — isolate your own consumer; never let it throw into emit().
diagnostics_channel.channel(name).subscribe((msg) => {
  try { handle(msg as DiagnosticEvent); } catch (err) { logger.error(err); }
});
```

The core swallows errors in `emit`/`registerChannel`, but a listener you attach
directly runs inside the synchronous `publish` — guard it yourself, as the
Telescope watcher's `safeRecord` does.
Source: `packages/telescope/src/diagnostic.watcher.ts` (`safeRecord`).
