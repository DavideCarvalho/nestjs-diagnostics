/**
 * A process-wide registry of which `aviary:<lib>:<event>` channels are already
 * recorded as a first-class, typed Telescope entry by a lib-specific watcher
 * (e.g. nestjs-agent's own watcher for `aviary:agent:*`, nestjs-media's for
 * `aviary:media:*`). The generic `DiagnosticWatcher` in
 * `@dudousxd/nestjs-diagnostics-telescope` auto-subscribes to EVERY registered
 * channel (see {@link registerChannel}), so without this registry every event a
 * claiming lib emits would be recorded TWICE: once as its own typed entry, once
 * as a generic `diagnostic` entry. Claiming a key tells the generic watcher "I
 * already record this — skip it by default."
 *
 * ## RAW convention (no dependency on this package required)
 * The registry is a plain `Map<string, number>` behind a well-known
 * `Symbol.for` key, so a package that does NOT want to depend on
 * `@dudousxd/nestjs-diagnostics` can still participate by replicating this
 * structure exactly, without importing anything from here:
 *
 * - `Symbol.for('aviary:diagnostics:claims')` resolves to a
 *   `Map<string, number>` stored on `globalThis`.
 * - Each key is `` `${lib}:${event}` `` — the same label the "Busiest events"
 *   dashboard panel and `DiagnosticWatcherOptions.exclude` use.
 * - The value is a reference count, always `>= 1` while the key is claimed by
 *   at least one caller. Claiming an already-claimed key increments the count;
 *   releasing decrements it; the key is deleted (unclaimed again) only once the
 *   count reaches `0`. This is what lets two independent watchers claim the
 *   same key without one's release un-claiming it for the other.
 * - A key is "claimed" iff the map has it; "unclaimed" iff absent (or its count
 *   reached `0` and was deleted).
 *
 * ## Record-time-check contract
 * A generic observer (like `DiagnosticWatcher`) MUST call
 * {@link isDiagnosticClaimed} at RECORD time — when an event is actually
 * published — not at subscribe time. This makes claiming order-independent: a
 * lib-specific watcher may call {@link claimDiagnostics} before or after the
 * generic watcher's `register()` runs, and every event recorded after the claim
 * exists is skipped either way. Checking once at subscribe time would miss
 * claims registered later and could not un-skip a released claim either.
 */

/** The registry state: `lib:event` key → active claim count (`>= 1`). */
type ClaimStore = Map<string, number>;

const CLAIMS_KEY = Symbol.for('aviary:diagnostics:claims');
const claimsGlobal = globalThis as typeof globalThis & { [CLAIMS_KEY]?: ClaimStore };
const claims: ClaimStore = claimsGlobal[CLAIMS_KEY] ?? new Map<string, number>();
claimsGlobal[CLAIMS_KEY] = claims;

/** The `lib:event` label used as the claim-store key, same shape as `exclude` entries. */
function claimKey(lib: string, event: string): string {
  return `${lib}:${event}`;
}

/**
 * Claim `lib:event` for every event in `events`, so a generic observer skips
 * them by default (see the record-time-check contract above). Call this once
 * when a lib-specific watcher registers, passing every event it records as a
 * typed entry.
 *
 * Reference-counted: claiming a key already claimed by a different call (e.g.
 * two Telescope instances, or overlapping event lists) increments its count
 * instead of overwriting it, so releasing one caller's claim never un-claims a
 * key another caller still holds.
 *
 * Returns a release function that removes EXACTLY the keys this call added —
 * decrementing each of `events`' counts by one, deleting the key only once its
 * count reaches `0`. Idempotent: calling the release function more than once
 * has no additional effect.
 *
 * ```ts
 * const release = claimDiagnostics('agent', ['chat-request', 'tool-call']);
 * // ... later, e.g. on watcher cleanup:
 * release();
 * ```
 */
export function claimDiagnostics(lib: string, events: readonly string[]): () => void {
  const keys = events.map((event) => claimKey(lib, event));
  for (const key of keys) {
    claims.set(key, (claims.get(key) ?? 0) + 1);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const key of keys) {
      const count = claims.get(key);
      if (count === undefined) continue;
      if (count <= 1) claims.delete(key);
      else claims.set(key, count - 1);
    }
  };
}

/**
 * Whether `lib:event` is currently claimed by at least one
 * {@link claimDiagnostics} call. Intended to be checked at record time by a
 * generic observer, per the contract above.
 */
export function isDiagnosticClaimed(lib: string, event: string): boolean {
  return claims.has(claimKey(lib, event));
}
