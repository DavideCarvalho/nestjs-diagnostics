/**
 * A process-wide registry of every `aviary:<lib>:<event>` channel name created or
 * emitted through this package.
 *
 * `node:diagnostics_channel` has no wildcard subscription: you can only subscribe
 * to a channel by its exact name. A generic observer (the Telescope watcher) that
 * wants to record *all* diagnostics therefore needs to (a) subscribe to every
 * channel that exists now and (b) be told when a new one appears. This registry
 * provides both: {@link registeredChannels} for the current set and
 * {@link onChannelRegistered} for future additions.
 */

/** Every channel name seen so far, in insertion order. */
const channels = new Set<string>();

/** Listeners notified once per newly-registered channel name. */
const listeners = new Set<(name: string) => void>();

/**
 * Record a channel name, notifying {@link onChannelRegistered} listeners the first
 * time it is seen. Idempotent: re-registering an existing name is a no-op.
 * Called by {@link getChannel}/{@link emit} so every channel touched through this
 * package is discoverable.
 */
export function registerChannel(name: string): void {
  if (channels.has(name)) return;
  channels.add(name);
  for (const listener of listeners) {
    try {
      listener(name);
    } catch {
      // A misbehaving observer must never break event emission.
    }
  }
}

/** A snapshot of every `aviary:<lib>:<event>` channel registered so far. */
export function registeredChannels(): string[] {
  return [...channels];
}

/**
 * Subscribe to channel registrations. The callback fires once per channel name
 * registered *after* this call. Returns an unsubscribe function.
 *
 * Note: this does NOT replay existing channels — a generic watcher should pair
 * it with {@link registeredChannels} to cover current + future names:
 *
 * ```ts
 * for (const name of registeredChannels()) subscribe(name);
 * const off = onChannelRegistered(subscribe);
 * ```
 */
export function onChannelRegistered(cb: (name: string) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Test-only: forget every registered channel and listener. Not part of the
 * public contract — exposed so suites can assert registration in isolation.
 */
export function resetRegistry(): void {
  channels.clear();
  listeners.clear();
}
