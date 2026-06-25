---
name: telescope-watcher
description: Record every @dudousxd/nestjs-diagnostics event in the Telescope dashboard with @dudousxd/nestjs-diagnostics-telescope. nestjsDiagnosticsTelescope({ topEventsLimit, recentLimit }) is one generic extension passed to TelescopeModule.forRoot({ extensions }); a single DiagnosticWatcher subscribes to every aviary:<lib>:<event> channel (current and future) and writes one diagnostic entry per publish, with payload as content, traceId, and tags lib:<lib> / event:<event>. Adds a Diagnostics dashboard (diagnostics.topEvents, diagnostics.recentEvents). No per-library watcher needed.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-diagnostics-telescope"
  library_version: 0.4.0
  framework: nestjs
---

# Record diagnostics in Telescope

`@dudousxd/nestjs-diagnostics-telescope` is a `@dudousxd/nestjs-telescope`
extension. ONE generic watcher records **every** `aviary:<lib>:<event>`
diagnostics event — from any `@dudousxd/nestjs-*` library — as a `diagnostic`
entry in the Telescope dashboard. No per-library watcher needed.

## Setup

```bash
pnpm add @dudousxd/nestjs-diagnostics-telescope
# peers: @dudousxd/nestjs-telescope, plus @dudousxd/nestjs-diagnostics on producers
```

Pass the extension to Telescope at the app root:

```ts
import { TelescopeModule } from '@dudousxd/nestjs-telescope';
import { nestjsDiagnosticsTelescope } from '@dudousxd/nestjs-diagnostics-telescope';

@Module({
  imports: [
    TelescopeModule.forRoot({
      extensions: [nestjsDiagnosticsTelescope()],
    }),
  ],
})
export class AppModule {}
```

Then anywhere a library emits, a `diagnostic` entry lands in Telescope with
`content` = the payload, the envelope's `traceId`, and tags
`lib:<lib>` / `event:<event>`:

```ts
import { Injectable } from '@nestjs/common';
import { emit } from '@dudousxd/nestjs-diagnostics';

@Injectable()
export class BillingService {
  markInvoicePaid(invoiceId: string, amount: number) {
    emit('billing', 'invoice-paid', { invoiceId, amount });
  }
}
```

Source: `packages/telescope/src/diagnostics-telescope.extension.ts`,
`packages/telescope/src/diagnostic.watcher.ts`.

## Core patterns

### 1. One generic watcher auto-subscribes to current + future channels

`node:diagnostics_channel` has no wildcard, so on `register` the
`DiagnosticWatcher` subscribes to every channel already in the diagnostics
registry (`registeredChannels()`) and registers an `onChannelRegistered` callback
so any channel that appears later (a library's first `emit('newlib', …)`) is
subscribed automatically. Subscribing also flips each producer's
`channel.hasSubscribers` to `true`, which is what makes `emit()` start publishing.

Source: `packages/telescope/src/diagnostic.watcher.ts` (`DiagnosticWatcher.register`).

### 2. Tuning the dashboard panels

`nestjsDiagnosticsTelescope(options)` accepts `topEventsLimit` (busiest
`lib:event` pairs panel, default 10) and `recentLimit` (recent-events table,
default 50):

```ts
nestjsDiagnosticsTelescope({ topEventsLimit: 20, recentLimit: 100 });
```

The extension contributes a `diagnostic` entry type (sky dot), a "Diagnostics"
dashboard, and two data providers — `diagnostics.topEvents` and
`diagnostics.recentEvents`.

Source: `packages/telescope/src/diagnostics-telescope.extension.ts` (`DiagnosticsTelescopeOptions`, `dashboards`, `dataProviders`).

### 3. What a recorded entry looks like

Each publish becomes a `RecordInput` with `type: 'diagnostic'`, `familyHash`
`<lib>:<event>` (so the dashboard rolls up "billing:invoice-paid"), tags, and a
`DiagnosticEntryContent` (`v`, `lib`, `event`, `ts`, `traceId`, `payload`). An
emitter-supplied `durationMs` is forwarded so a downstream OTel exporter can feed
a histogram. Malformed envelopes are rejected by `isDiagnosticEvent`.

Source: `packages/telescope/src/diagnostic.watcher.ts` (`buildDiagnosticEntry`, `isDiagnosticEvent`, `DiagnosticEntryContent`).

## Common mistakes

### Calling the extension's name as a string instead of invoking the factory

```ts
// Wrong — passing the module specifier / the function itself, not its result.
TelescopeModule.forRoot({ extensions: ['nestjs-diagnostics'] });
TelescopeModule.forRoot({ extensions: [nestjsDiagnosticsTelescope] }); // not called
```

```ts
// Correct — call the factory; it returns the TelescopeExtension object.
TelescopeModule.forRoot({ extensions: [nestjsDiagnosticsTelescope()] });
```

`nestjsDiagnosticsTelescope()` builds and returns the extension (with its
`watchers`/`entryTypes`/`dashboards`/`dataProviders` hooks); the bare reference or
a string is not a valid extension.
Source: `packages/telescope/src/diagnostics-telescope.extension.ts` (`nestjsDiagnosticsTelescope` returns `TelescopeExtension`).

### Adding a per-library watcher alongside this one

```ts
// Wrong — a bespoke watcher per library double-records and is unnecessary.
extensions: [nestjsDiagnosticsTelescope(), myBillingDiagnosticsWatcher()];
```

```ts
// Correct — the single generic watcher already covers every aviary channel.
extensions: [nestjsDiagnosticsTelescope()];
```

One `DiagnosticWatcher` subscribes to all current and future `aviary:<lib>:<event>`
channels, so every library's events are recorded without a per-library watcher.
Source: `packages/telescope/src/diagnostics-telescope.extension.ts` (`watchers()` returns one `DiagnosticWatcher`).

### Expecting entries when no producer ever emits

```ts
// Wrong — registering the extension but never emitting anything.
TelescopeModule.forRoot({ extensions: [nestjsDiagnosticsTelescope()] });
// (no library calls emit / trace) — the Diagnostics page stays empty
```

```ts
// Correct — a producer must emit on an aviary channel for entries to appear.
import { emit } from '@dudousxd/nestjs-diagnostics';
emit('billing', 'invoice-paid', { invoiceId, amount });
```

The watcher only records what is published; a channel is registered the first
time a producer touches it, and entries appear only on actual `emit`/`trace`.
Source: `packages/telescope/src/diagnostic.watcher.ts` (`safeRecord` records on publish).
