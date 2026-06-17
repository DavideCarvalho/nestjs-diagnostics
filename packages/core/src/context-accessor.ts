/**
 * Local, structural mirror of `@dudousxd/nestjs-context`'s public accessor
 * (`packages/core/src/accessor.ts`).
 *
 * We deliberately do NOT import nestjs-context (it is an OPTIONAL peer). Instead
 * we declare the same shape here; any object that structurally satisfies this
 * interface — including nestjs-context's real accessor — can be registered via
 * {@link setContextAccessor} so {@link emit} can auto-fill `traceId`.
 *
 * Kept byte-aligned with nestjs-context's `ContextAccessor`: `traceId()` /
 * `tenantId()` / `userRef()` / `get()` are all present so the structural match
 * stays exact and a future use of any of them is type-safe.
 */
export interface UserRef {
  type: string;
  id: string | number;
}

/** Opaque shape of the context store. diagnostics never reads it; mirrors the upstream surface. */
export type ContextStore = Record<string, unknown>;

export interface ContextAccessor {
  /** Trace id for the current request, or `undefined` when unavailable. */
  traceId(): string | undefined;
  /** Current tenant id, or `undefined` when no multi-tenant context is populated. */
  tenantId(): string | undefined;
  /** Reference to the current user, or `undefined` when unauthenticated. */
  userRef(): UserRef | undefined;
  /** The raw context store for the current request, or `undefined`. */
  get(): ContextStore | undefined;
}

/**
 * The shared token nestjs-context publishes its accessor under. Exposed so a
 * Nest app can `{ provide: CONTEXT_ACCESSOR, useExisting: ... }` and a consumer
 * can `@Inject(CONTEXT_ACCESSOR) @Optional()` it — symmetric with how the rest
 * of the `@dudousxd/nestjs-*` family wires the optional context peer.
 */
export const CONTEXT_ACCESSOR = Symbol.for('@dudousxd/nestjs-context:accessor');

/**
 * Module-level accessor used by {@link emit} to auto-fill `traceId`. `null` until
 * an app calls {@link setContextAccessor} (e.g. from a Nest module's `onModuleInit`
 * after resolving the optional {@link CONTEXT_ACCESSOR} provider). Kept out of
 * the hot path: when unset, `emit` simply leaves `traceId` undefined.
 */
let accessor: ContextAccessor | null = null;

/** Register (or clear, with `null`) the accessor {@link emit} reads `traceId` from. */
export function setContextAccessor(next: ContextAccessor | null): void {
  accessor = next;
}

/** The currently registered accessor, or `null`. */
export function getContextAccessor(): ContextAccessor | null {
  return accessor;
}

/** Resolve the current trace id from the registered accessor, never throwing. */
export function resolveTraceId(): string | undefined {
  if (accessor == null) return undefined;
  try {
    return accessor.traceId();
  } catch {
    return undefined;
  }
}
