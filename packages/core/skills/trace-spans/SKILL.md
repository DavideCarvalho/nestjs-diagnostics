---
name: trace-spans
description: Emit span-like start/end/asyncStart/asyncEnd/error events with trace(lib, event, fn, payload, opts) and tracingChannel(lib, event) from @dudousxd/nestjs-diagnostics. Wraps sync or async operations over aviary:<lib>:<event>:<phase> sub-channels, producing SpanEvent envelopes with spanId, durationMs, result and error so observers reconstruct real spans. Zero overhead when no span sub-channel has subscribers; never throws; SPAN_SCHEMA_VERSION, traceChannelNames.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-diagnostics"
  library_version: 0.6.0
  framework: nestjs
---

# Trace operations as spans

`emit` publishes a single POINT event. `trace` wraps an operation and publishes
span-like **start / end / asyncStart / asyncEnd / error** events with timing, so
observers can reconstruct real start↔end↔error pairs (durable steps, authz
decisions, cache fetches). It mirrors Node's `diagnostics_channel.tracingChannel`
sub-channels but stays inside the `aviary:` convention.

## Setup

```bash
pnpm add @dudousxd/nestjs-diagnostics
```

```ts
import { Injectable } from '@nestjs/common';
import { trace } from '@dudousxd/nestjs-diagnostics';

@Injectable()
export class AuthzService {
  evaluate(req: Request) {
    // Sync op: publishes start then end (with result) — or error on throw.
    return trace('authz', 'decision', () => this.run(req), { subject: req.user });
  }

  async runStep(input: StepInput) {
    // Async op: start, end (sync portion), asyncStart, then asyncEnd (with result).
    return await trace('durable', 'step', () => this.execute(input), { name: 'charge' });
  }
}
```

Span events ride `aviary:<lib>:<event>:<phase>`; the base `aviary:<lib>:<event>`
name is what gets registered for discovery. A `SpanEvent` carries `v`, `ts`,
`lib`, `event`, `phase`, a per-span `spanId`, optional `traceId`, and
`payload` / `result` / `error` / `durationMs` depending on the phase.

Source: `packages/core/src/trace.ts`, `packages/core/src/types.ts` (`SpanEvent`, `SpanPhase`).

## Core patterns

### 1. The span lifecycle

- **Sync `fn`** → `start` (carries `payload`), then on return `end` (carries
  `result` + `durationMs`); on throw `error` (carries `error` + `durationMs`).
  The return value / throw is propagated to the caller unchanged.
- **Async `fn`** (returns a promise) → `start` synchronously, then `end` for the
  sync portion, `asyncStart`, and finally `asyncEnd` (with `result` + `durationMs`)
  on fulfilment or `error` on rejection. The promise is returned to the caller.

Every phase event of one `trace` call shares a `spanId`, so observers pair them
without relying on subscription order. `durationMs` is measured with
`performance.now()`.

Source: `packages/core/src/trace.ts` (`trace`, `publishPhase`).

### 2. Zero overhead when unobserved

When NO span sub-channel has a subscriber, `trace` calls `fn()` and returns its
value directly — no `spanId`, no envelope, no timing. The hot path is just five
`hasSubscribers` reads (`anySubscribed`).

```ts
// In prod with no observer: equivalent to `return this.run(req)`.
const decision = trace('authz', 'decision', () => this.run(req), { subject });
```

Source: `packages/core/src/trace.ts` (`anySubscribed`, the early `return fn()`).

### 3. tracingChannel for a hot, fixed call site

Bind `trace` to one `(lib, event)` pair when a call site always traces the same
operation:

```ts
import { tracingChannel } from '@dudousxd/nestjs-diagnostics';

const decision = tracingChannel('authz', 'decision');
// decision.name      -> 'aviary:authz:decision'
// decision.channels  -> the five span sub-channel names (traceChannelNames)

const out = decision.trace(() => evaluate(req), { subject });
```

Source: `packages/core/src/trace.ts` (`tracingChannel`, `TracingChannel`, `traceChannelNames`).

## Common mistakes

### Passing an already-invoked promise instead of a thunk

```ts
// Wrong — fn() is called by you, so trace can't bracket start/end around it.
trace('durable', 'step', this.execute(input)); // type error: not a function
```

```ts
// Correct — pass a zero-arg function; trace invokes it between start and end.
await trace('durable', 'step', () => this.execute(input), { name: 'charge' });
```

`trace(lib, event, fn, payload?, opts?)` takes a `fn: () => R` it calls itself;
the promise must be created inside the thunk so `start` precedes it.
Source: `packages/core/src/trace.ts` (`trace` signature).

### Forgetting to return / await the trace result

```ts
// Wrong — the operation runs but the caller loses its value and unhandled rejections.
async charge() {
  trace('durable', 'step', () => this.execute());
}
```

```ts
// Correct — trace returns fn's value (or its promise); return/await it.
async charge() {
  return await trace('durable', 'step', () => this.execute());
}
```

`trace` is transparent: it returns exactly what `fn` returns (the same promise for
async). Drop the return and you drop the result and its error handling.
Source: `packages/core/src/trace.ts` (`trace` returns `result` / the settled promise).

### Subscribing only to the base channel and expecting span events

```ts
// Wrong — span phases are published on sub-channels, not the base name.
import diagnostics_channel from 'node:diagnostics_channel';
diagnostics_channel.channel('aviary:authz:decision').subscribe(onSpan); // never fires
```

```ts
// Correct — subscribe to the phase sub-channels via traceChannelNames.
import { traceChannelNames } from '@dudousxd/nestjs-diagnostics';
const n = traceChannelNames('authz', 'decision');
for (const name of [n.start, n.end, n.asyncStart, n.asyncEnd, n.error]) {
  diagnostics_channel.channel(name).subscribe(onSpan);
}
```

`trace` publishes on `aviary:<lib>:<event>:start|end|asyncStart|asyncEnd|error`;
only the base name is registered for discovery, so a generic observer must derive
the sub-channels.
Source: `packages/core/src/trace.ts` (`traceChannelNames`, `getSpanChannels`).
