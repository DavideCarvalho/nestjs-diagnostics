# `@OnDiagnostic` Decorator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `@dudousxd/nestjs-diagnostics/nestjs` subpath to the existing core package: `@OnDiagnostic(lib, event?)` + `DiagnosticsModule.forRoot()` + a `DiagnosticsExplorer` that subscribes diagnostics channels to provider methods, for ergonomic DI-friendly in-app reactions to any `aviary:<lib>:<event>` event.

**Architecture:** A method decorator stores `{lib, event?}` subscription metadata via `Reflect`. A `DiscoveryService`-based explorer scans provider methods on `OnApplicationBootstrap`, subscribes each declared channel (exact, or every `aviary:<lib>:*` for a wildcard — current and future via `onChannelRegistered`) to a never-throwing wrapper that invokes the method, and unsubscribes on shutdown. Lives at a subpath so the main barrel stays `@nestjs`-free.

**Tech Stack:** TypeScript (`tsc`, NodeNext, `.js` import specifiers), Node ≥20, vitest + `unplugin-swc`, `node:diagnostics_channel`, `@nestjs/common` + `@nestjs/core` (optional peers).

## Global Constraints

- Subpath name exactly **`@dudousxd/nestjs-diagnostics/nestjs`**; source under `packages/core/src/nestjs/`; the main barrel `src/index.ts` is **not modified** (no `@nestjs` import enters `dist/index.js`).
- `@nestjs/common`, `@nestjs/core`, `reflect-metadata` are **optional** peers (`peerDependenciesMeta`).
- Tests live in `packages/core/test/` (the repo convention; `tsconfig.json` excludes `test/`), named `*.spec.ts`, importing source via `../src/...js`.
- NodeNext: every relative import uses a **`.js`** extension. `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` are on — no `key: undefined` assignments (use conditional spreads); index access yields `T | undefined`.
- The explorer must **never let a handler throw or reject into the producer** — `diagnostics_channel.publish` is synchronous, so a throwing subscriber would propagate into `emit()`.
- Mirror `@dudousxd/nestjs-resilience/packages/core/src/nest/{explorer,decorators}.ts` (DiscoveryService scan + Reflect metadata) and the telescope `diagnostic.watcher.ts` (subscribe / `onChannelRegistered` / unsubscribe).

---

## File Structure

```
packages/core/
├── package.json                 # MODIFY: exports gains ./nestjs; add optional peers + @nestjs devDeps
├── vitest.config.ts             # MODIFY: enable swc legacy decorators + reflect-metadata setup
├── src/nestjs/
│   ├── on-diagnostic.decorator.ts   # @OnDiagnostic + ON_DIAGNOSTIC_META + OnDiagnosticMeta
│   ├── diagnostics.explorer.ts      # DiagnosticsExplorer (subscribe channels → methods)
│   ├── diagnostics.module.ts        # DiagnosticsModule.forRoot()
│   └── index.ts                     # subpath public exports
└── test/
    ├── setup.ts                     # CREATE: import 'reflect-metadata'
    ├── on-diagnostic.decorator.spec.ts
    └── diagnostics.explorer.spec.ts
```

`src/index.ts` (the main barrel) already exports `channelName`, `CHANNEL_PREFIX`, `getChannel`, `registeredChannels`, `onChannelRegistered`, `emit`, `resetRegistry`, and the type `DiagnosticEvent` — the new code imports these from the sibling source files.

---

### Task 1: Package wiring + `@OnDiagnostic` decorator

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/vitest.config.ts`
- Create: `packages/core/test/setup.ts`
- Create: `packages/core/src/nestjs/on-diagnostic.decorator.ts`
- Test: `packages/core/test/on-diagnostic.decorator.spec.ts`

**Interfaces:**
- Produces: `const ON_DIAGNOSTIC_META: symbol`; `interface OnDiagnosticMeta { lib: string; event?: string }`; `function OnDiagnostic(lib: string, event?: string): MethodDecorator`. Metadata is an `OnDiagnosticMeta[]` stored on the method (prototype + method name), appended per decorator application.

- [ ] **Step 1: Add the subpath export + optional peers + dev deps to `packages/core/package.json`**

In the `"exports"` object, add the `./nestjs` entry alongside `"."`:

```jsonc
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  },
  "./nestjs": {
    "types": "./dist/nestjs/index.d.ts",
    "import": "./dist/nestjs/index.js",
    "default": "./dist/nestjs/index.js"
  }
}
```

Add these top-level keys (after `"exports"`):

```jsonc
"peerDependencies": {
  "@nestjs/common": "^10 || ^11",
  "@nestjs/core": "^10 || ^11",
  "reflect-metadata": "^0.2"
},
"peerDependenciesMeta": {
  "@nestjs/common": { "optional": true },
  "@nestjs/core": { "optional": true },
  "reflect-metadata": { "optional": true }
},
```

In `"devDependencies"`, add (keep the existing entries):

```jsonc
"@nestjs/common": "^11",
"@nestjs/core": "^11",
"@nestjs/testing": "^11",
"reflect-metadata": "^0.2",
"unplugin-swc": "^1.5.1"
```

(`unplugin-swc` is already used by `vitest.config.ts`; pin it in devDeps if absent.)

- [ ] **Step 2: Install**

Run (repo root `/home/dudousxd/personal/oss/nestjs/nestjs-diagnostics`): `pnpm install`
Expected: completes; `@nestjs/*`, `@nestjs/testing`, `reflect-metadata` resolve into `packages/core/node_modules`.

- [ ] **Step 3: Enable decorator transforms in `packages/core/vitest.config.ts`**

The existing tests use no decorators, so swc isn't configured for them. Replace the file with:

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.{spec,test}.ts'],
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
  },
});
```

- [ ] **Step 4: Create the reflect-metadata setup file `packages/core/test/setup.ts`**

```ts
import 'reflect-metadata';
```

- [ ] **Step 5: Confirm the existing suite still passes under the new config**

Run: `pnpm -C packages/core test`
Expected: the existing `channel` / `registry` / `trace` / `typed-registry` specs all still pass (no decorators in them; the config change is backward-compatible).

- [ ] **Step 6: Write the failing decorator test**

Create `packages/core/test/on-diagnostic.decorator.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ON_DIAGNOSTIC_META,
  OnDiagnostic,
  type OnDiagnosticMeta,
} from '../src/nestjs/on-diagnostic.decorator.js';

function metaOf(ctor: object, method: string): OnDiagnosticMeta[] {
  return Reflect.getMetadata(ON_DIAGNOSTIC_META, ctor, method) as OnDiagnosticMeta[];
}

describe('OnDiagnostic', () => {
  it('records an exact (lib, event) subscription', () => {
    class C {
      @OnDiagnostic('resilience', 'circuit-opened')
      h() {}
    }
    expect(metaOf(C.prototype, 'h')).toEqual([{ lib: 'resilience', event: 'circuit-opened' }]);
  });

  it('records a lib wildcard (no event key)', () => {
    class C {
      @OnDiagnostic('resilience')
      h() {}
    }
    expect(metaOf(C.prototype, 'h')).toEqual([{ lib: 'resilience' }]);
  });

  it('accumulates stacked decorators (order-independent)', () => {
    class C {
      @OnDiagnostic('resilience', 'failover')
      @OnDiagnostic('authz', 'decision')
      h() {}
    }
    const metas = metaOf(C.prototype, 'h');
    expect(metas).toHaveLength(2);
    expect(metas).toContainEqual({ lib: 'resilience', event: 'failover' });
    expect(metas).toContainEqual({ lib: 'authz', event: 'decision' });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm -C packages/core test on-diagnostic.decorator`
Expected: FAIL — cannot resolve `../src/nestjs/on-diagnostic.decorator.js`.

- [ ] **Step 8: Implement the decorator**

Create `packages/core/src/nestjs/on-diagnostic.decorator.ts`:

```ts
/** Metadata key under which a method's @OnDiagnostic subscriptions accumulate. */
export const ON_DIAGNOSTIC_META = Symbol('diagnostics:on');

/** One subscription declared on a method. `event` omitted = every event of `lib`. */
export interface OnDiagnosticMeta {
  lib: string;
  event?: string;
}

/**
 * Subscribe a provider method to a diagnostics channel. Requires
 * `DiagnosticsModule.forRoot()` to be imported so the explorer wires it up.
 *
 * - `@OnDiagnostic('resilience', 'circuit-opened')` — the exact channel.
 * - `@OnDiagnostic('resilience')` — every `aviary:resilience:*` channel (current + future).
 *
 * Stackable: apply more than once to react to several channels with one method.
 */
export function OnDiagnostic(lib: string, event?: string): MethodDecorator {
  return (target, key) => {
    const existing =
      (Reflect.getMetadata(ON_DIAGNOSTIC_META, target, key) as OnDiagnosticMeta[] | undefined) ?? [];
    const meta: OnDiagnosticMeta = { lib, ...(event !== undefined ? { event } : {}) };
    Reflect.defineMetadata(ON_DIAGNOSTIC_META, [...existing, meta], target, key);
  };
}
```

(Do not `import 'reflect-metadata'` here — the consuming Nest app and the test `setup.ts` provide it; keeping it out avoids bundling the polyfill.)

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm -C packages/core test on-diagnostic.decorator`
Expected: PASS — 3 tests.

- [ ] **Step 10: Typecheck**

Run: `pnpm -C packages/core typecheck`
Expected: no errors. (The decorator file compiles under `tsc`; `src/nestjs/` is included by `src/**/*.ts`.)

- [ ] **Step 11: Commit**

```bash
git add packages/core/package.json packages/core/vitest.config.ts packages/core/test/setup.ts packages/core/src/nestjs/on-diagnostic.decorator.ts packages/core/test/on-diagnostic.decorator.spec.ts pnpm-lock.yaml
git commit -m "feat(nestjs): @OnDiagnostic decorator + subpath wiring"
```

---

### Task 2: `DiagnosticsExplorer` + `DiagnosticsModule` + subpath exports

**Files:**
- Create: `packages/core/src/nestjs/diagnostics.explorer.ts`
- Create: `packages/core/src/nestjs/diagnostics.module.ts`
- Create: `packages/core/src/nestjs/index.ts`
- Test: `packages/core/test/diagnostics.explorer.spec.ts`

**Interfaces:**
- Consumes (Task 1): `ON_DIAGNOSTIC_META`, `type OnDiagnosticMeta`.
- Consumes (main barrel, via `../channel.js` / `../registry.js` / `../types.js`): `channelName(lib, event): string`, `CHANNEL_PREFIX: 'aviary'`, `registeredChannels(): string[]`, `onChannelRegistered(cb: (name: string) => void): () => void`, `type DiagnosticEvent`.
- Consumes (`@nestjs/core`): `DiscoveryService.getProviders()` (each has `.instance`), `MetadataScanner.getAllMethodNames(proto): string[]`, `DiscoveryModule`.
- Produces: `class DiagnosticsExplorer` (`@Injectable`, `OnApplicationBootstrap` + `OnApplicationShutdown`); `class DiagnosticsModule { static forRoot(): DynamicModule }`.

- [ ] **Step 1: Write the failing explorer test**

Create `packages/core/test/diagnostics.explorer.spec.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emit, resetRegistry } from '../src/index.js';
import type { DiagnosticEvent } from '../src/index.js';
import { DiagnosticsModule } from '../src/nestjs/diagnostics.module.js';
import { OnDiagnostic } from '../src/nestjs/on-diagnostic.decorator.js';

@Injectable()
class Reactions {
  readonly exact: DiagnosticEvent[] = [];
  readonly lib: DiagnosticEvent[] = [];

  @OnDiagnostic('resilience', 'circuit-opened')
  onOpen(e: DiagnosticEvent) {
    this.exact.push(e);
  }

  @OnDiagnostic('resilience')
  onAny(e: DiagnosticEvent) {
    this.lib.push(e);
  }
}

async function boot(providers: unknown[] = [Reactions]) {
  const moduleRef = await Test.createTestingModule({
    imports: [DiagnosticsModule.forRoot()],
    providers: providers as never,
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

describe('DiagnosticsExplorer', () => {
  beforeEach(() => resetRegistry());

  it('invokes the exact handler with the full envelope; DI works', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    emit('resilience', 'circuit-opened', { key: 'payments' });
    expect(r.exact).toHaveLength(1);
    expect(r.exact[0]).toMatchObject({ lib: 'resilience', event: 'circuit-opened', payload: { key: 'payments' } });
    await app.close();
  });

  it('the exact binding does not fire for a different event of the same lib', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    emit('resilience', 'failover', { target: 'vonage' });
    expect(r.exact).toHaveLength(0);
    expect(r.lib).toHaveLength(1); // the wildcard did fire
    await app.close();
  });

  it('the lib wildcard fires for a channel first registered AFTER bootstrap', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    emit('resilience', 'timeout', { key: 'api' }); // channel registered now, via onChannelRegistered
    expect(r.lib).toHaveLength(1);
    expect(r.lib[0]).toMatchObject({ event: 'timeout' });
    await app.close();
  });

  it('the lib wildcard fires for a channel already registered BEFORE bootstrap', async () => {
    emit('resilience', 'retry', { n: 1 }); // registers aviary:resilience:retry, no subscriber yet
    const app = await boot();
    const r = app.get(Reactions);
    emit('resilience', 'retry', { n: 2 });
    expect(r.lib).toHaveLength(1); // picked up by the registeredChannels() loop at bootstrap
    await app.close();
  });

  it('does not fire for another library', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    emit('authz', 'decision', { allow: true });
    expect(r.exact).toHaveLength(0);
    expect(r.lib).toHaveLength(0);
    await app.close();
  });

  it('a throwing handler never breaks the emitter', async () => {
    @Injectable()
    class Boom {
      @OnDiagnostic('billing', 'charged')
      h() {
        throw new Error('boom');
      }
    }
    const app = await boot([Boom]);
    expect(() => emit('billing', 'charged', {})).not.toThrow();
    await app.close();
  });

  it('an async rejecting handler is swallowed (no throw into emit)', async () => {
    @Injectable()
    class AsyncBoom {
      @OnDiagnostic('billing', 'charged')
      async h() {
        throw new Error('async boom');
      }
    }
    const app = await boot([AsyncBoom]);
    expect(() => emit('billing', 'charged', {})).not.toThrow();
    await new Promise((r) => setImmediate(r)); // let the rejected promise settle
    await app.close();
  });

  it('stops invoking handlers after the app closes', async () => {
    const app = await boot();
    const r = app.get(Reactions);
    await app.close();
    emit('resilience', 'circuit-opened', { key: 'x' });
    expect(r.exact).toHaveLength(0);
    expect(r.lib).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C packages/core test diagnostics.explorer`
Expected: FAIL — cannot resolve `../src/nestjs/diagnostics.module.js`.

- [ ] **Step 3: Implement the explorer**

Create `packages/core/src/nestjs/diagnostics.explorer.ts`:

```ts
import diagnostics_channel from 'node:diagnostics_channel';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CHANNEL_PREFIX, channelName } from '../channel.js';
import { onChannelRegistered, registeredChannels } from '../registry.js';
import type { DiagnosticEvent } from '../types.js';
import { ON_DIAGNOSTIC_META, type OnDiagnosticMeta } from './on-diagnostic.decorator.js';

type Invoke = (event: DiagnosticEvent) => void;

@Injectable()
export class DiagnosticsExplorer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DiagnosticsExplorer');
  private readonly subscriptions: Array<{ name: string; listener: (msg: unknown) => void }> = [];
  private readonly wildcards: Array<{ prefix: string; invoke: Invoke }> = [];
  private offChannelRegistered: (() => void) | null = null;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const metas = Reflect.getMetadata(ON_DIAGNOSTIC_META, proto, methodName) as
          | OnDiagnosticMeta[]
          | undefined;
        if (!metas?.length) continue;
        for (const meta of metas) {
          const invoke: Invoke = (event) => this.safeInvoke(instance, methodName, event);
          if (meta.event !== undefined) {
            this.subscribe(channelName(meta.lib, meta.event), invoke);
          } else {
            const prefix = `${CHANNEL_PREFIX}:${meta.lib}:`;
            this.wildcards.push({ prefix, invoke });
            for (const name of registeredChannels()) {
              if (name.startsWith(prefix)) this.subscribe(name, invoke);
            }
          }
        }
      }
    }
    this.offChannelRegistered = onChannelRegistered((name) => {
      for (const w of this.wildcards) {
        if (name.startsWith(w.prefix)) this.subscribe(name, w.invoke);
      }
    });
  }

  onApplicationShutdown(): void {
    this.offChannelRegistered?.();
    this.offChannelRegistered = null;
    for (const { name, listener } of this.subscriptions) {
      diagnostics_channel.channel(name).unsubscribe(listener);
    }
    this.subscriptions.length = 0;
    this.wildcards.length = 0;
  }

  /** Subscribe once to `name`; the listener fans the envelope into `invoke`. */
  private subscribe(name: string, invoke: Invoke): void {
    const listener = (msg: unknown) => invoke(msg as DiagnosticEvent);
    diagnostics_channel.channel(name).subscribe(listener);
    this.subscriptions.push({ name, listener });
  }

  /** Invoke a handler, swallowing sync throws and async rejections so a buggy
   *  reaction can never break the synchronous `emit()` that triggered it. */
  private safeInvoke(instance: Record<string, unknown>, methodName: string, event: DiagnosticEvent): void {
    try {
      const fn = instance[methodName] as (e: DiagnosticEvent) => unknown;
      const result = fn.call(instance, event);
      if (result != null && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch((err) => this.logError(methodName, err));
      }
    } catch (err) {
      this.logError(methodName, err);
    }
  }

  private logError(methodName: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`@OnDiagnostic ${methodName} handler failed: ${message}`);
  }
}
```

- [ ] **Step 4: Implement the module**

Create `packages/core/src/nestjs/diagnostics.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DiagnosticsExplorer } from './diagnostics.explorer.js';

@Module({})
export class DiagnosticsModule {
  /** Register once at the app root; enables `@OnDiagnostic` on any provider. */
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

- [ ] **Step 5: Create the subpath barrel `packages/core/src/nestjs/index.ts`**

```ts
export { ON_DIAGNOSTIC_META, OnDiagnostic } from './on-diagnostic.decorator.js';
export type { OnDiagnosticMeta } from './on-diagnostic.decorator.js';
export { DiagnosticsModule } from './diagnostics.module.js';
export { DiagnosticsExplorer } from './diagnostics.explorer.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm -C packages/core test diagnostics.explorer`
Expected: PASS — 8 tests. (The decorator suite still passes too.)

- [ ] **Step 7: Typecheck and build**

Run: `pnpm -C packages/core typecheck`
Expected: no errors.

Run: `pnpm -C packages/core build`
Expected: `tsc` emits `dist/nestjs/index.js`, `dist/nestjs/diagnostics.explorer.js`, `dist/nestjs/diagnostics.module.js`, `dist/nestjs/on-diagnostic.decorator.js` (+ `.d.ts`), and `dist/index.js` is unchanged.

- [ ] **Step 8: Confirm the main barrel stays `@nestjs`-free**

Run: `grep -rl "@nestjs" packages/core/dist/index.js packages/core/dist/channel.js packages/core/dist/registry.js`
Expected: no matches (the `@nestjs` imports live only under `dist/nestjs/`).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/nestjs/diagnostics.explorer.ts packages/core/src/nestjs/diagnostics.module.ts packages/core/src/nestjs/index.ts packages/core/test/diagnostics.explorer.spec.ts
git commit -m "feat(nestjs): DiagnosticsExplorer + DiagnosticsModule subscribe channels to @OnDiagnostic methods"
```

---

### Task 3: README, changeset, verification

**Files:**
- Modify: `packages/core/README.md`
- Create: `.changeset/on-diagnostic.md`

**Interfaces:**
- Consumes (Task 1–2): the public exports from `@dudousxd/nestjs-diagnostics/nestjs`.

- [ ] **Step 1: Document the subpath in `packages/core/README.md`**

Append this section to the end of the file:

````markdown
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
````

- [ ] **Step 2: Add a changeset**

Create `.changeset/on-diagnostic.md`:

```md
---
"@dudousxd/nestjs-diagnostics": minor
---

Add the `@dudousxd/nestjs-diagnostics/nestjs` subpath: `@OnDiagnostic(lib, event?)`,
`DiagnosticsModule.forRoot()`, and a `DiscoveryService` explorer that subscribes
diagnostics channels to provider methods for ergonomic, DI-friendly in-app
reactions. `@nestjs/*` are optional peers; the main barrel stays
framework-agnostic.
```

(If `.changeset/` does not exist in this repo, skip this step and note it in your report.)

- [ ] **Step 3: Full package verification**

Run: `pnpm -C packages/core typecheck`
Expected: no errors.

Run: `pnpm -C packages/core test`
Expected: all suites pass — the existing `channel`/`registry`/`trace`/`typed-registry` specs plus the new `on-diagnostic.decorator` (3) and `diagnostics.explorer` (8).

Run: `pnpm -C packages/core build`
Expected: builds; `dist/nestjs/` present.

- [ ] **Step 4: Commit**

```bash
git add packages/core/README.md .changeset/on-diagnostic.md
git commit -m "docs(nestjs): document @OnDiagnostic + changeset"
```

---

## Notes for the implementer

- **`.js` import specifiers everywhere** (NodeNext). The new files import siblings as `'./on-diagnostic.decorator.js'`, `'../channel.js'`, etc. — never extensionless.
- **`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`**: build the wildcard meta with a conditional spread (`{ lib, ...(event !== undefined ? { event } : {}) }`), never `{ lib, event: undefined }`. Index access (`metas[i]`, `r.exact[0]`) is `T | undefined` — the tests use `toMatchObject` on `?.`-safe values or after a length assertion.
- **Decorator transforms in tests** come from the swc config in Task 1; `reflect-metadata` from `test/setup.ts`. If a decorator test throws `Reflect.getMetadata is not a function`, the setup file isn't loaded — re-check `vitest.config.ts` `setupFiles`.
- **DI without param-type metadata**: the explorer injects with explicit `@Inject(DiscoveryService)` / `@Inject(MetadataScanner)` tokens (swc/esbuild do not reliably emit constructor param types) — keep them explicit; do not rely on type-only injection.
- **Lifecycle**: `OnApplicationBootstrap` (not `OnModuleInit`) so every provider exists before scanning; `OnApplicationShutdown` fires on `app.close()` (tests rely on this for cleanup).
- **Reference**: `nestjs-resilience/packages/core/src/nest/explorer.ts` (scan + Reflect) and `nestjs-diagnostics/packages/telescope/src/diagnostic.watcher.ts` (subscribe/`onChannelRegistered`/unsubscribe) are the working analogs — read them if a Nest or channel API behaves unexpectedly.
- If a `@nestjs/core` export (`DiscoveryService`, `MetadataScanner`, `DiscoveryModule`, `getAllMethodNames`) differs from this plan in the installed version, trust the installed typings and note the deviation in your report.
