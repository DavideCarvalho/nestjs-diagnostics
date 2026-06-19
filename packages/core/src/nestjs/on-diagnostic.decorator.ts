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
