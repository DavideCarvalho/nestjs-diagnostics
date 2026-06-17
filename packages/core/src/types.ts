/**
 * The envelope every `@dudousxd/nestjs-*` library publishes over
 * `node:diagnostics_channel`. It is the cross-repo wire contract: the generic
 * Telescope watcher (and any other observer) reads exactly these fields, so keep
 * the shape stable. The `payload` is opaque — its meaning is owned by the
 * emitting library and identified by `lib` + `event`.
 */
export interface DiagnosticEvent<TPayload = unknown> {
  /** Epoch millis when the event was emitted (`Date.now()` at publish time). */
  ts: number;
  /** The emitting library, e.g. `'billing'` — the `<lib>` in `aviary:<lib>:<event>`. */
  lib: string;
  /** The event name, e.g. `'invoice-paid'` — the `<event>` in `aviary:<lib>:<event>`. */
  event: string;
  /** Trace id for the current request, when resolvable from a context accessor. */
  traceId?: string;
  /** The library-defined payload. Opaque to this package and to observers. */
  payload: TPayload;
}

/** Optional per-emit overrides. */
export interface EmitOptions {
  /**
   * An explicit trace id for this event. When provided it wins over the
   * registered {@link ContextAccessor}. Omit to auto-fill from the accessor (if
   * any), or leave `traceId` undefined.
   */
  traceId?: string;
}
