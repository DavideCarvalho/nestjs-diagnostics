import diagnostics_channel, { type Channel } from 'node:diagnostics_channel';
import { resolveTraceId } from './context-accessor.js';
import { registerChannel } from './registry.js';
import type { DiagnosticEvent, EmitOptions } from './types.js';

/** The prefix all channels created by this convention share. */
export const CHANNEL_PREFIX = 'aviary';

/**
 * The channel name for a `<lib>`/`<event>` pair: `aviary:<lib>:<event>`. This is
 * the cross-repo wire contract — keep it identical on producer and observer.
 */
export function channelName(lib: string, event: string): string {
  return `${CHANNEL_PREFIX}:${lib}:${event}`;
}

/**
 * The memoized `node:diagnostics_channel` for a `<lib>`/`<event>` pair. Node
 * returns the same {@link Channel} object for the same name, so reading
 * `.hasSubscribers` is the cheap gate before building an envelope. Touching the
 * channel also records its name in the {@link registerChannel registry} so a
 * generic observer can discover it.
 */
export function getChannel(lib: string, event: string): Channel {
  const name = channelName(lib, event);
  const channel = diagnostics_channel.channel(name);
  registerChannel(name);
  return channel;
}

/**
 * Emit a diagnostics event on `aviary:<lib>:<event>`.
 *
 * - The envelope's `ts` is `Date.now()` evaluated *inside* this call (never at
 *   module load).
 * - `traceId` is taken from `opts.traceId` if given, else auto-filled from the
 *   registered context accessor (if resolvable), else left undefined.
 * - The envelope is built and published ONLY when the channel `hasSubscribers`,
 *   so emitting is effectively free when nothing is listening.
 * - Never throws: emitting observability must not break the caller.
 *
 * ```ts
 * emit('billing', 'invoice-paid', { invoiceId: 'inv_123', amount: 4200 });
 * ```
 */
export function emit(lib: string, event: string, payload: unknown, opts?: EmitOptions): void {
  const channel = getChannel(lib, event);
  if (!channel.hasSubscribers) return;
  try {
    const traceId = opts?.traceId ?? resolveTraceId();
    const envelope: DiagnosticEvent = {
      ts: Date.now(),
      lib,
      event,
      ...(traceId !== undefined ? { traceId } : {}),
      payload,
    };
    channel.publish(envelope);
  } catch {
    // Observability must never break the emitting code path.
  }
}
