/**
 * Envelopes a relay is re-emitting right now: copies of an event that was emitted in ANOTHER
 * process. Listener dispatch reads it to deliver only at the origin. With a delivering transport
 * (`queue`, `durable`), the process that called `emit` hands each `(listener, event)` pair over
 * once, and a relayed copy of the same event is never handed over again.
 *
 * Held on a `Symbol.for` slot of `globalThis`, so relays and dispatch agree even when more than
 * one copy of this package is loaded.
 */
const RELAYED_KEY = Symbol.for('@dudousxd/nestjs-diagnostics:relayed');
const slots = globalThis as typeof globalThis & { [RELAYED_KEY]?: WeakSet<object> };
const relayed: WeakSet<object> = slots[RELAYED_KEY] ?? new WeakSet<object>();
slots[RELAYED_KEY] = relayed;

/**
 * Run `publish` with `env` marked as a relayed copy. Call it from a relay that re-emits an event
 * received from another process onto the local bus.
 */
export function publishRelayed(env: object, publish: () => void): void {
  relayed.add(env);
  try {
    publish();
  } finally {
    relayed.delete(env);
  }
}

/** Whether `env` is a relayed copy being re-emitted right now (it was emitted in another process). */
export function isRelayed(env: object): boolean {
  return relayed.has(env);
}
