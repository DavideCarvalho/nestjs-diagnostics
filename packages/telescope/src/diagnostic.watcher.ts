import diagnostics_channel, { type Channel } from 'node:diagnostics_channel';
import {
  type DiagnosticEvent,
  onChannelRegistered,
  registeredChannels,
} from '@dudousxd/nestjs-diagnostics';
import type { RecordInput, Watcher, WatcherContext } from '@dudousxd/nestjs-telescope';

/** Telescope entry `type` produced by this watcher. */
export const DIAGNOSTIC_ENTRY_TYPE = 'diagnostic';

/**
 * What a single recorded diagnostic entry looks like in the Telescope dashboard.
 * Mirrors the {@link DiagnosticEvent} envelope, with the library-defined data
 * preserved verbatim under `payload`.
 */
export interface DiagnosticEntryContent {
  /**
   * Envelope schema version the producer stamped, or `null` for a legacy
   * envelope published before schema versioning existed.
   */
  v: number | null;
  /** The emitting library, e.g. `'billing'`. */
  lib: string;
  /** The event within that library, e.g. `'invoice-paid'`. */
  event: string;
  /** Epoch millis the producer stamped the event with. */
  ts: number;
  /** The trace id the producer resolved, or `null` when none. */
  traceId: string | null;
  /** The library-defined payload, recorded as-is. */
  payload: unknown;
}

/**
 * The ONE generic nestjs-telescope watcher behind
 * `@dudousxd/nestjs-diagnostics-telescope`. It records every event any
 * `@dudousxd/nestjs-*` library emits through `@dudousxd/nestjs-diagnostics` —
 * one `diagnostic` entry per `aviary:<lib>:<event>` publish — without needing a
 * bespoke watcher per library.
 *
 * ## How it auto-subscribes to current + future channels
 * `node:diagnostics_channel` has no wildcard, so on `register` the watcher:
 *  1. subscribes to every channel already in the diagnostics
 *     {@link registeredChannels registry}, and
 *  2. registers an {@link onChannelRegistered} callback so any channel that
 *     appears later (a library's first `emit('newlib', …)`) is subscribed too.
 *
 * Subscribing also flips each producer's `channel.hasSubscribers` to `true`,
 * which is what makes `emit()` start building + publishing envelopes at all
 * (zero-overhead when nobody listens).
 */
export class DiagnosticWatcher implements Watcher {
  readonly type = DIAGNOSTIC_ENTRY_TYPE;
  private registered = false;
  private offChannelRegistered: (() => void) | null = null;
  /** name → the subscribe listener we attached, so cleanup can detach exactly. */
  private readonly subscriptions = new Map<string, (msg: unknown) => void>();

  register(ctx: WatcherContext): void {
    if (this.registered) return;
    this.registered = true;

    for (const name of registeredChannels()) this.subscribe(ctx, name);
    this.offChannelRegistered = onChannelRegistered((name) => this.subscribe(ctx, name));
  }

  /** Unsubscribe from every channel and stop watching for new ones. */
  cleanup(): void {
    this.offChannelRegistered?.();
    this.offChannelRegistered = null;
    for (const [name, listener] of this.subscriptions) {
      diagnostics_channel.channel(name).unsubscribe(listener);
    }
    this.subscriptions.clear();
    this.registered = false;
  }

  /** Subscribe once to `name`, recording each publish as a `diagnostic` entry. */
  private subscribe(ctx: WatcherContext, name: string): void {
    if (this.subscriptions.has(name)) return;
    const listener = (msg: unknown) => this.safeRecord(ctx, msg);
    this.subscriptions.set(name, listener);
    const channel: Channel = diagnostics_channel.channel(name);
    channel.subscribe(listener);
  }

  /** Validate + record, swallowing any failure so a producer can never break. */
  private safeRecord(ctx: WatcherContext, msg: unknown): void {
    try {
      if (!isDiagnosticEvent(msg)) return;
      ctx.record(buildDiagnosticEntry(msg));
    } catch (err) {
      // NOT rethrown — telescope must never break an emitting code path.
      console.error('DiagnosticWatcher: failed to record diagnostic event:', err);
    }
  }
}

/** Map a {@link DiagnosticEvent} envelope to a Telescope `RecordInput`. */
export function buildDiagnosticEntry(msg: DiagnosticEvent): RecordInput<DiagnosticEntryContent> {
  const content: DiagnosticEntryContent = {
    // Tolerate envelopes from emitters that predate schema versioning.
    v: msg.v ?? null,
    lib: msg.lib,
    event: msg.event,
    ts: msg.ts,
    traceId: msg.traceId ?? null,
    payload: msg.payload,
  };
  return {
    type: DIAGNOSTIC_ENTRY_TYPE,
    // Group by lib + event so the dashboard can roll up "billing:invoice-paid".
    familyHash: `${msg.lib}:${msg.event}`,
    tags: [
      `lib:${msg.lib}`,
      `event:${msg.event}`,
      ...(msg.traceId ? [`trace:${msg.traceId}`] : []),
    ],
    content,
    // Forward the emitter-supplied duration so the OTel exporter can feed it
    // into a histogram instrument instead of only incrementing a counter.
    // Only set the key when the envelope carried a duration; omit it otherwise
    // so the Recorder treats it as "unknown duration" (null after enrichment).
    ...(msg.durationMs !== undefined && { durationMs: msg.durationMs }),
  };
}

/** Strict structural validation of a diagnostics envelope. */
export function isDiagnosticEvent(msg: unknown): msg is DiagnosticEvent {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.ts === 'number' &&
    typeof m.lib === 'string' &&
    typeof m.event === 'string' &&
    'payload' in m &&
    (m.traceId === undefined || typeof m.traceId === 'string') &&
    // Tolerate legacy envelopes without `v`; reject a malformed (non-number) one.
    (m.v === undefined || typeof m.v === 'number')
  );
}
