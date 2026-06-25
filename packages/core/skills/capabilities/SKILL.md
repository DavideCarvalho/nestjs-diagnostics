---
name: capabilities
description: Share cross-library DI tokens via the capability half of the @dudousxd/nestjs-diagnostics protocol. capability(lib, name) mints a Symbol.for('@dudousxd/nestjs-<lib>:<name>') token producer and consumer resolve identically without importing each other; InjectCapability(lib, name) from /nestjs optionally injects a peer's capability; assertCapabilityNaming guards naming drift in contract tests; CapabilityRegistry/CapabilityOf give typed tokens via declaration merging. Mirrors channelName for events.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-diagnostics"
  library_version: 0.6.0
  framework: nestjs
---

# Cross-library capabilities (DI tokens)

`@dudousxd/nestjs-diagnostics` carries two halves of one ecosystem protocol: the
**event** transport (`emit` / channels) and **capabilities** — stable DI tokens
two `@dudousxd/nestjs-*` libraries share **without importing each other**. A
capability token is `Symbol.for('@dudousxd/nestjs-<lib>:<name>')`; because it goes
through the global symbol registry, producer and consumer resolve the SAME symbol.
It is the dependency-injection mirror of `channelName(lib, event)` for events.

## Setup

```bash
pnpm add @dudousxd/nestjs-diagnostics
# InjectCapability requires @nestjs/common
```

A producer library binds its capability under the shared token:

```ts
import { Module } from '@nestjs/common';
import { capability } from '@dudousxd/nestjs-diagnostics';
import { ContextAccessorImpl } from './accessor.js';

// token === Symbol.for('@dudousxd/nestjs-context:accessor')
@Module({
  providers: [
    ContextAccessorImpl,
    { provide: capability('context', 'accessor'), useExisting: ContextAccessorImpl },
  ],
  exports: [capability('context', 'accessor')],
})
export class ContextModule {}
```

Source: `packages/core/src/capability.ts`, `packages/core/src/inject-capability.ts`.

## Core patterns

### 1. capability(lib, name) — the shared token

`capability('context', 'accessor')` returns
`Symbol.for('@dudousxd/nestjs-context:accessor')`. Any code in any package that
calls it with the same `(lib, name)` gets the identical symbol, so a consumer can
inject a producer's capability with no static dependency between them.

```ts
import { capability } from '@dudousxd/nestjs-diagnostics';
const TOKEN = capability('context', 'accessor');
```

Source: `packages/core/src/capability.ts` (`capability`).

### 2. InjectCapability(lib, name) — optional cross-lib injection

From the `/nestjs` subpath, `InjectCapability` is shorthand for
`@Optional() @Inject(capability(lib, name))` — when the producer library is
absent, the parameter is `undefined` instead of breaking injection:

```ts
import { Injectable } from '@nestjs/common';
import { InjectCapability } from '@dudousxd/nestjs-diagnostics/nestjs';
import type { ContextAccessor } from '@dudousxd/nestjs-diagnostics';

@Injectable()
export class AuditService {
  constructor(
    @InjectCapability('context', 'accessor')
    private readonly ctx?: ContextAccessor, // undefined when nestjs-context absent
  ) {}
}
```

You annotate the parameter type yourself (capability payload types are not auto-
inferred across repos).

Source: `packages/core/src/inject-capability.ts` (`InjectCapability`).

### 3. assertCapabilityNaming — anti-drift guard for contract tests

Assert every exported token of a library follows the canonical
`@dudousxd/nestjs-<lib>:<name>` naming (i.e. was minted by `capability(lib, …)`).
It throws naming the offending export, turning drift into a red test:

```ts
import { assertCapabilityNaming, capability } from '@dudousxd/nestjs-diagnostics';

const tokens = { ACCESSOR: capability('context', 'accessor') };

it('all capability tokens follow the naming convention', () => {
  expect(() => assertCapabilityNaming('context', tokens)).not.toThrow();
});
```

Source: `packages/core/src/conformance.ts` (`assertCapabilityNaming`).

## Common mistakes

### Minting the token with Symbol() instead of capability()

```ts
// Wrong — a unique symbol; the consumer's capability('context','accessor') won't match it.
const TOKEN = Symbol('@dudousxd/nestjs-context:accessor');
```

```ts
// Correct — Symbol.for via capability() so all copies resolve the same token.
import { capability } from '@dudousxd/nestjs-diagnostics';
const TOKEN = capability('context', 'accessor');
```

`Symbol(desc)` is always unique; only `Symbol.for(key)` (what `capability` uses)
returns a process-shared symbol that producer and consumer both resolve.
Source: `packages/core/src/capability.ts` (`capability`).

### Injecting a capability without @Optional and crashing when the peer is absent

```ts
// Wrong — hard @Inject throws "Nest can't resolve dependency" when the producer isn't loaded.
constructor(@Inject(capability('context', 'accessor')) private ctx: ContextAccessor) {}
```

```ts
// Correct — InjectCapability is already optional; ctx is undefined when absent.
constructor(@InjectCapability('context', 'accessor') private ctx?: ContextAccessor) {}
```

`InjectCapability` applies `Optional()` then `Inject(token)`, so a missing peer
yields `undefined` rather than a resolution error — the whole point of an optional
cross-library capability.
Source: `packages/core/src/inject-capability.ts` (`Optional()` + `Inject(token)`).

### Confusing capability tokens with event channels

```ts
// Wrong — capability is a DI token, not a channel; you cannot subscribe to it.
import diagnostics_channel from 'node:diagnostics_channel';
diagnostics_channel.channel(capability('context', 'accessor') as any); // type/runtime error
```

```ts
// Correct — events go over channelName(); capabilities are injected.
import { channelName } from '@dudousxd/nestjs-diagnostics';
diagnostics_channel.channel(channelName('billing', 'invoice-paid')).subscribe(fn);
```

Capabilities (`Symbol.for(...)` DI tokens) and channels (`aviary:<lib>:<event>`
strings) are the two distinct halves of the protocol — one is injected, the other
is published/subscribed.
Source: `packages/core/src/capability.ts`, `packages/core/src/channel.ts`.
