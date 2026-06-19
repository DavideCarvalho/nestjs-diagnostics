---
"@dudousxd/nestjs-diagnostics": minor
---

Add the "capabilities" half of the integration protocol, alongside the existing event transport:

- `capability(lib, name)` — single canonical source for cross-lib DI token names (`@dudousxd/nestjs-<lib>:<name>` via `Symbol.for`), the mirror of `channelName`.
- `CapabilityRegistry` (augmentable via declaration merging) + `CapabilityOf<TLib, TName>` — the typed registry mirroring `ChannelRegistry`/`PayloadOf`.
- `InjectCapability(lib, name)` — optional, typed parameter injector equivalent to `@Optional() @Inject(capability(lib, name))`, removing hand-copied magic-string tokens between libraries.
- `assertCapabilityNaming(lib, tokens)` — contract-test helper that turns token-naming drift into a failing test.
