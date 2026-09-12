/**
 * The stable DI token for the capability `<lib>:<name>`, built from the canonical
 * `@dudousxd/nestjs-<lib>:<name>` name. Because it goes through the global symbol
 * registry (`Symbol.for`), a producer and a consumer living in different libs —
 * neither importing the other — resolve the SAME symbol. Mirrors the event
 * transport's `channelName(lib, event)`, on the other side of the same protocol.
 *
 * The naming is a convention, not an exclusive factory: a token spelled by hand
 * with the same string IS the same symbol, which is what lets a lib adopt this
 * without a breaking change. `CONTEXT_ACCESSOR` in `context-accessor.ts` is
 * exactly that case — `capability('context', 'accessor')` resolves to it.
 */
export function capability(lib: string, name: string): symbol {
  return Symbol.for(`@dudousxd/nestjs-${lib}:${name}`);
}

/**
 * Typed capability registry, augmented by libs through declaration merging — the
 * exact mirror of the event transport's `ChannelRegistry`. Empty by default; the
 * untyped (`unknown`) path is always available.
 *
 * ```ts
 * declare module '@dudousxd/nestjs-diagnostics' {
 *   interface CapabilityRegistry {
 *     context: { accessor: ContextAccessor };
 *   }
 * }
 * ```
 */
export interface CapabilityRegistry {}

/**
 * The type declared for `(TLib, TName)` in the {@link CapabilityRegistry}, or
 * `unknown` when the pair is not registered. Mirrors `PayloadOf` from the event
 * transport.
 */
export type CapabilityOf<
  TLib extends string,
  TName extends string,
> = TLib extends keyof CapabilityRegistry
  ? TName extends keyof CapabilityRegistry[TLib]
    ? CapabilityRegistry[TLib][TName]
    : unknown
  : unknown;
