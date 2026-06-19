/**
 * O token de DI estável para a capability `<lib>:<name>`. Fonte única do naming
 * `@dudousxd/nestjs-<lib>:<name>`. Como usa o registry global de símbolos
 * (`Symbol.for`), produtor e consumidor em libs diferentes — sem se importarem —
 * resolvem o MESMO símbolo. Espelha o `channelName(lib, event)` do transporte de
 * eventos, do outro lado do mesmo protocolo.
 */
export function capability(lib: string, name: string): symbol {
  return Symbol.for(`@dudousxd/nestjs-${lib}:${name}`);
}

/**
 * Registry tipado de capabilities, augmentado pelas libs via declaration merging
 * — espelho exato do `ChannelRegistry` do transporte de eventos. Vazio por
 * padrão; o caminho não-tipado (`unknown`) está sempre disponível.
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
 * O tipo declarado para `(TLib, TName)` no {@link CapabilityRegistry}, ou
 * `unknown` quando o par não está registrado. Espelha `PayloadOf` do
 * transporte de eventos.
 */
export type CapabilityOf<
  TLib extends string,
  TName extends string,
> = TLib extends keyof CapabilityRegistry
  ? TName extends keyof CapabilityRegistry[TLib]
    ? CapabilityRegistry[TLib][TName]
    : unknown
  : unknown;
