---
name: emit-diagnostics
description: Emit observability events from @dudousxd/nestjs-diagnostics with emit(lib, event, payload, opts) over node:diagnostics_channel on aviary:<lib>:<event>. Covers the DiagnosticEvent envelope (v, ts, lib, event, traceId, payload, durationMs), zero-overhead hasSubscribers gating, EmitOptions sampling and durationMs, typed ChannelRegistry declaration merging, and trace correlation via setContextAccessor / CONTEXT_ACCESSOR. No module to register; the core barrel is framework-agnostic.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-diagnostics"
  library_version: 0.6.0
  framework: nestjs
---

# Emit diagnostics events

`@dudousxd/nestjs-diagnostics` is a tiny convention for emitting observability
events over Node's built-in `node:diagnostics_channel`. A library calls
`emit('billing', 'invoice-paid', payload)` and is done — whoever wants to observe
subscribes. Emitting is effectively free when nothing is listening.

There is **nothing to register** to emit: no module, no provider. The main barrel
is a set of pure functions and is framework-agnostic (importable from non-Nest
code).

## Setup

```bash
pnpm add @dudousxd/nestjs-diagnostics
```

Call `emit` from any provider where something interesting happens:

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

Every event flows over a channel named `aviary:<lib>:<event>` and carries a
standard `DiagnosticEvent` envelope:

```ts
interface DiagnosticEvent<TPayload = unknown> {
  v?: number;        // SCHEMA_VERSION stamped by emit (currently 1)
  ts: number;        // Date.now() at publish time
  lib: string;       // the <lib>, e.g. "billing"
  event: string;     // the <event>, e.g. "invoice-paid"
  traceId?: string;  // auto-filled from a context accessor when present
  payload: TPayload; // your library-defined data
  durationMs?: number; // set only when EmitOptions.durationMs is passed
}
```

Source: `packages/core/src/channel.ts`, `packages/core/src/types.ts`.

## Core patterns

### 1. Zero-overhead emit (the central guarantee)

`emit` builds and publishes the envelope **only when the channel has
subscribers** (`channel.hasSubscribers`), so a production process with no
observer attached pays essentially nothing per call — just two `Map.get`s and a
boolean read. It also **never throws**: observability must never break the
emitting code path.

```ts
// In prod with no Telescope/observer attached, this allocates no envelope.
emit('authz', 'decision', { subject, allow: true });
```

Source: `packages/core/src/channel.ts` (`emit`, the `hasSubscribers` gate).

### 2. EmitOptions: explicit traceId, sampling, durationMs

```ts
import { emit } from '@dudousxd/nestjs-diagnostics';

// Explicit trace id (wins over the registered accessor):
emit('billing', 'invoice-paid', payload, { traceId });

// Load-shedding on a hot event — shed 90%, consulted only AFTER hasSubscribers
// and BEFORE the envelope is built (no allocation when skipped):
emit('authz', 'decision', payload, { sample: () => Math.random() < 0.1 });

// Stamp a duration so downstream observers can build histograms:
emit('cache', 'lookup', { key }, { durationMs: 4.2 });
```

`sample` returning `false` (or throwing) sheds the event without allocating the
envelope. `durationMs` is set on the envelope only when provided, keeping the
common envelope shape monomorphic.

Source: `packages/core/src/types.ts` (`EmitOptions`), `packages/core/src/channel.ts`.

### 3. Compile-time payload types via the typed ChannelRegistry

By default every `(lib, event)` pair takes `payload: unknown`. A library can opt
specific channels into compile-time payload checking by augmenting
`ChannelRegistry` through TypeScript declaration merging — the untyped path stays
open for every other channel:

```ts
declare module '@dudousxd/nestjs-diagnostics' {
  interface ChannelRegistry {
    billing: {
      'invoice-paid': { invoiceId: string; amount: number };
    };
  }
}

emit('billing', 'invoice-paid', { invoiceId: 'inv_1', amount: 4200 }); // checked
emit('anything', 'else', whatever);                                    // still unknown
```

This is a purely type-level mechanism: no runtime registry of payload shapes,
nothing allocated.

Source: `packages/core/src/types.ts` (`ChannelRegistry`, `LibOf`, `EventOf`, `PayloadOf`).

### 4. Auto-correlated traceId via setContextAccessor

If your app uses `@dudousxd/nestjs-context` (an optional peer — never imported by
this package), register its accessor once and every `emit` auto-fills `traceId`
from the current request:

```ts
import { setContextAccessor, CONTEXT_ACCESSOR } from '@dudousxd/nestjs-diagnostics';
import { Inject, Optional, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ContextAccessor } from '@dudousxd/nestjs-diagnostics';

@Injectable()
export class DiagnosticsContextBridge implements OnModuleInit {
  constructor(
    @Optional() @Inject(CONTEXT_ACCESSOR) private readonly accessor?: ContextAccessor,
  ) {}

  onModuleInit() {
    if (this.accessor) setContextAccessor(this.accessor);
  }
}
```

`CONTEXT_ACCESSOR` is `Symbol.for('@dudousxd/nestjs-context:accessor')` — the same
token nestjs-context publishes under. Any object structurally matching the
`ContextAccessor` interface works. `resolveTraceId()` reads it, never throwing.

Source: `packages/core/src/context-accessor.ts`.

## Common mistakes

### Building the payload eagerly outside emit on a hot path

```ts
// Wrong — serialize() runs every call even when nobody is listening.
const snapshot = serialize(hugeObject);
emit('jobs', 'tick', snapshot);
```

```ts
// Correct — gate expensive work behind hasSubscribers via getChannel.
import { getChannel, emit } from '@dudousxd/nestjs-diagnostics';
if (getChannel('jobs', 'tick').hasSubscribers) {
  emit('jobs', 'tick', serialize(hugeObject));
}
```

`emit` only skips allocating *its own* envelope when unsubscribed; it cannot skip
work you did before calling it. Read `hasSubscribers` yourself for expensive
payloads (or use `EmitOptions.sample` for cheap ones).
Source: `packages/core/src/channel.ts` (`emit`, `getChannel`).

### Expecting emit to throw or return a delivery result

```ts
// Wrong — emit never throws and returns void; there is no ack to await/catch.
try {
  const ok = await emit('billing', 'invoice-paid', payload);
} catch (e) { /* never reached */ }
```

```ts
// Correct — fire-and-forget; do not branch on its result.
emit('billing', 'invoice-paid', payload);
```

`emit` returns `void` and swallows every internal error so a broken observer can
never break the producer. There is no delivery guarantee, ordering, or replay.
Source: `packages/core/src/channel.ts` (`emit` `try/catch`).

### Putting the prefix or colons into lib/event yourself

```ts
// Wrong — emit already prepends 'aviary:' and joins with ':'.
emit('aviary:billing', 'invoice:paid', payload); // channel: aviary:aviary:billing:invoice:paid
```

```ts
// Correct — pass the bare lib and event segments.
emit('billing', 'invoice-paid', payload);        // channel: aviary:billing:invoice-paid
```

`channelName(lib, event)` builds `aviary:<lib>:<event>`; passing pre-joined names
produces a malformed channel that observers subscribed to `aviary:billing:*` will
miss.
Source: `packages/core/src/channel.ts` (`channelName`, `CHANNEL_PREFIX`).
