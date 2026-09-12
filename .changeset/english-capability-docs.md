---
"@dudousxd/nestjs-diagnostics": patch
---

Document the capability token trio in English, and correct two claims

Comment-only change to `capability.ts`, `inject-capability.ts` and
`conformance.ts`, the only three source files whose doc comments were written in
Portuguese. Two statements were also wrong and are fixed: `capability()` is not
the single source of the `@dudousxd/nestjs-<lib>:<name>` naming (`CONTEXT_ACCESSOR`
spells the same token by hand, as `capability.spec.ts` pins), and
`assertCapabilityNaming` checks the token's name, not that `capability()` minted
it. `InjectCapability`'s dangling pointer to an out-of-repo plan is replaced with
the in-repo `CapabilityOf` type and the reason it is exported from the `/nestjs`
subpath only. No runtime behavior changes.
