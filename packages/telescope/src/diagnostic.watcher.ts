import diagnostics_channel, { type Channel } from 'node:diagnostics_channel';
import {
  CHANNEL_PREFIX,
  type DiagnosticEvent,
  type SpanEvent,
  type SpanPhase,
  isDiagnosticClaimed,
  onChannelRegistered,
  registeredChannels,
  traceChannelNames,
} from '@dudousxd/nestjs-diagnostics';
import type { RecordInput, Watcher, WatcherContext } from '@dudousxd/nestjs-telescope';

/** Telescope entry `type` produced by this watcher. Shared by point AND span entries. */
export const DIAGNOSTIC_ENTRY_TYPE = 'diagnostic';

/** Construction options for {@link DiagnosticWatcher}. */
export interface DiagnosticWatcherOptions {
  /**
   * `lib:event` keys to skip recording — the exact label the "Busiest events"
   * dashboard panel shows (e.g. `'media:upload.progress'`). High-frequency
   * channels can flood the timeline; muting one here drops only its Telescope
   * entries. The event still publishes on its diagnostics channel, so other
   * subscribers (OTel, custom watchers) keep seeing it.
   */
  exclude?: readonly string[];
  /**
   * Record events whose `lib:event` key is CLAIMED by a lib-specific watcher —
   * e.g. nestjs-agent's or nestjs-media's own Telescope watcher, via
   * `claimDiagnostics` from `@dudousxd/nestjs-diagnostics`. Default `false`:
   * claimed keys are skipped here because the claiming lib already records them
   * as a typed entry, and recording them again would duplicate every such event
   * (once typed, once as a generic `diagnostic` entry). Set `true` to record
   * everything regardless of claims, e.g. to see the raw feed alongside the
   * typed one while debugging. Independent of `exclude`: `exclude` mutes noisy
   * events outright; `recordClaimed` only concerns events another watcher
   * already records.
   */
  recordClaimed?: boolean;
}

/** Fields common to both a point {@link DiagnosticEntryContent} and a {@link DiagnosticSpanEntryContent}. */
export interface DiagnosticEntryContentBase {
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
}

/**
 * What a single recorded POINT diagnostic entry looks like in the Telescope
 * dashboard. Mirrors the {@link DiagnosticEvent} envelope, with the
 * library-defined data preserved verbatim under `payload`.
 */
export interface DiagnosticEntryContent extends DiagnosticEntryContentBase {
  /** The library-defined payload, recorded as-is. */
  payload: unknown;
}

/**
 * What a single recorded SPAN diagnostic entry looks like — one per `trace()`
 * call, built from its TERMINAL {@link SpanEvent} (`end`/`asyncEnd`/`error`;
 * see {@link DiagnosticWatcher}). Unlike the point shape there is no `payload`:
 * the terminal envelope carries `result` (success) or `error` (failure)
 * instead, mirrored here verbatim.
 */
export interface DiagnosticSpanEntryContent extends DiagnosticEntryContentBase {
  /** Per-span correlation id shared by every phase event of one `trace()` call. */
  spanId: string;
  /**
   * The terminal phase that produced this entry. Typed as the full
   * {@link SpanPhase} union for simplicity, but in practice always `'end'`
   * (sync success), `'asyncEnd'` (async success), or `'error'` — the
   * `DiagnosticWatcher` only ever subscribes those three terminal sub-channels.
   */
  phase: SpanPhase;
  /** The operation's return value; present when `phase` is a success terminal. */
  result?: unknown;
  /** The thrown/rejected value; present when `phase` is `'error'`. */
  error?: unknown;
}

/**
 * The ONE generic nestjs-telescope watcher behind
 * `@dudousxd/nestjs-diagnostics-telescope`. It records every event any
 * `@dudousxd/nestjs-*` library emits through `@dudousxd/nestjs-diagnostics` —
 * one `diagnostic` entry per `aviary:<lib>:<event>` publish (POINT traffic, via
 * `emit()`), plus one `diagnostic` entry per completed span (SPAN traffic, via
 * `trace()`) — without needing a bespoke watcher per library.
 *
 * ## Point vs span, same entry `type`
 * Both shapes are recorded as `type: 'diagnostic'` so they share the existing
 * dashboards/panels/OTel counters unchanged — one recorded entry per logical
 * operation either way, so counts stay directly comparable whether a producer
 * used `emit()` or `trace()`. A span entry carries a `kind:span` tag (point
 * entries carry no `kind:*` tag) and its `content.phase`/`spanId`/`result`/
 * `error` fields — see {@link DiagnosticSpanEntryContent} — so a panel or
 * filter CAN tell them apart without a second dashboard.
 *
 * ## How it auto-subscribes to current + future channels
 * `node:diagnostics_channel` has no wildcard, so on `register` the watcher:
 *  1. subscribes to every channel already in the diagnostics
 *     {@link registeredChannels registry}, and
 *  2. registers an {@link onChannelRegistered} callback so any channel that
 *     appears later (a library's first `emit('newlib', …)` OR first
 *     `trace('newlib', …)`) is subscribed too.
 *
 * Subscribing also flips each producer's `channel.hasSubscribers` to `true`,
 * which is what makes `emit()`/`trace()` start building + publishing envelopes
 * at all (zero-overhead when nobody listens).
 *
 * ## Span recording (GAP 1 fix)
 * `trace()` never publishes to the BASE channel name itself (only `emit()`
 * does) — it publishes on the five {@link traceChannelNames} sub-channels
 * instead, and only the `start` phase carries a `payload` key. The registry
 * only ever records the base name (see `registerChannel(channels.base)` in
 * `trace.ts`), so `registeredChannels()`/`onChannelRegistered` still tell us
 * WHICH `(lib, event)` pairs exist; for each we derive the five span names via
 * `traceChannelNames` and subscribe the THREE terminal-carrying ones
 * (`end`/`asyncEnd`/`error`) — one entry is recorded per span, on whichever
 * terminal fires. `start`/`asyncStart` are deliberately left unsubscribed:
 * `trace()` gates each phase's publish on that phase's OWN
 * `channel.hasSubscribers`, so skipping them also skips building their
 * envelopes, for free.
 *
 * `end` is subtler than `asyncEnd`/`error`: for an ASYNC `trace()` call it
 * ALSO fires first as a "synchronous portion done" marker (no `result` key),
 * ahead of the real terminal on `asyncEnd`/`error` — recording that one too
 * would double-count the span. `safeRecordSpan` skips it via the same
 * present-vs-absent-key signal GAP 1 relies on for `payload`: a genuine sync
 * completion's `end` always carries the `result` key (even `undefined`-valued).
 */
export class DiagnosticWatcher implements Watcher {
  readonly type = DIAGNOSTIC_ENTRY_TYPE;
  private registered = false;
  private offChannelRegistered: (() => void) | null = null;
  /** name → the subscribe listener we attached, so cleanup can detach exactly. */
  private readonly subscriptions = new Map<string, (msg: unknown) => void>();
  /** `lib:event` keys whose events are dropped instead of recorded. */
  private readonly excluded: ReadonlySet<string>;
  /** See {@link DiagnosticWatcherOptions.recordClaimed}. */
  private readonly recordClaimed: boolean;

  constructor(options: DiagnosticWatcherOptions = {}) {
    this.excluded = new Set(options.exclude ?? []);
    this.recordClaimed = options.recordClaimed ?? false;
  }

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

  /**
   * Subscribe `name` (a registered BASE channel) for POINT traffic, and derive
   * + subscribe its span traffic — current AND future registrations both funnel
   * through here (see the class doc).
   */
  private subscribe(ctx: WatcherContext, name: string): void {
    this.subscribePoint(ctx, name);
    this.subscribeSpans(ctx, name);
  }

  /** Subscribe once to the base channel `name`, recording each publish as a `diagnostic` entry. */
  private subscribePoint(ctx: WatcherContext, name: string): void {
    if (this.subscriptions.has(name)) return;
    const listener = (msg: unknown) => this.safeRecord(ctx, msg);
    this.subscriptions.set(name, listener);
    const channel: Channel = diagnostics_channel.channel(name);
    channel.subscribe(listener);
  }

  /** Derive `baseName`'s span sub-channels and subscribe the three terminal ones — see the class doc's "Span recording" section. */
  private subscribeSpans(ctx: WatcherContext, baseName: string): void {
    const parsed = parseChannelName(baseName);
    if (parsed === null) return;
    const names = traceChannelNames(parsed.lib, parsed.event);
    for (const name of [names.end, names.asyncEnd, names.error]) {
      if (this.subscriptions.has(name)) continue;
      const listener = (msg: unknown) => this.safeRecordSpan(ctx, msg);
      this.subscriptions.set(name, listener);
      diagnostics_channel.channel(name).subscribe(listener);
    }
  }

  /** Validate + record a POINT event, swallowing any failure so a producer can never break. */
  private safeRecord(ctx: WatcherContext, msg: unknown): void {
    try {
      if (!isDiagnosticEvent(msg)) return;
      if (this.excluded.has(`${msg.lib}:${msg.event}`)) return;
      // Checked at RECORD time (not subscribe time) so claiming stays
      // order-independent — see the contract documented on isDiagnosticClaimed.
      if (!this.recordClaimed && isDiagnosticClaimed(msg.lib, msg.event)) return;
      ctx.record(buildDiagnosticEntry(msg));
    } catch (err) {
      // NOT rethrown — telescope must never break an emitting code path.
      console.error('DiagnosticWatcher: failed to record diagnostic event:', err);
    }
  }

  /**
   * Validate + record a TERMINAL span event, swallowing any failure so a
   * traced call can never break. Same `exclude`/`recordClaimed` gating as
   * point traffic, keyed by the same `lib:event` pair (phase-independent).
   *
   * `end` is subscribed but is NOT always the terminal: for an async `trace()`
   * call, `core`'s `trace()` publishes `end` first to mark the SYNCHRONOUS
   * portion completing (no `result` key at all — see `trace.ts`), then later
   * the REAL terminal on `asyncEnd`/`error`. Recording that premature `end` too
   * would double-count the span (two entries for one `trace()` call). A
   * genuine sync completion's `end` always carries the `result` key — even
   * when the value itself is `undefined` — so `'result' in msg` is the exact
   * same present-vs-absent-key signal GAP 1 already relies on for `payload`.
   */
  private safeRecordSpan(ctx: WatcherContext, msg: unknown): void {
    try {
      if (!isSpanEvent(msg)) return;
      if (msg.phase === 'end' && !('result' in msg)) return;
      if (this.excluded.has(`${msg.lib}:${msg.event}`)) return;
      if (!this.recordClaimed && isDiagnosticClaimed(msg.lib, msg.event)) return;
      ctx.record(buildDiagnosticSpanEntry(msg));
    } catch (err) {
      console.error('DiagnosticWatcher: failed to record span event:', err);
    }
  }
}

/**
 * Reverse `channelName(lib, event)` (`` `${CHANNEL_PREFIX}:${lib}:${event}` ``)
 * back into its `(lib, event)` parts, or `null` if `name` isn't shaped like an
 * `aviary:` channel. Splits on the FIRST remaining `:` — library names never
 * contain one (see every registered example: `billing`, `media`, `agent`…),
 * while event names may (`upload.progress` uses a dot, not a colon), so `event`
 * safely takes everything after that first separator.
 */
function parseChannelName(name: string): { lib: string; event: string } | null {
  const prefix = `${CHANNEL_PREFIX}:`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const separatorIndex = rest.indexOf(':');
  if (separatorIndex === -1) return null;
  return { lib: rest.slice(0, separatorIndex), event: rest.slice(separatorIndex + 1) };
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

/**
 * Map a TERMINAL {@link SpanEvent} envelope (`end`/`asyncEnd`/`error` — the
 * only phases `DiagnosticWatcher` subscribes) to a Telescope `RecordInput`,
 * one entry per span:
 *
 * - `durationMs` is forwarded from the envelope (always stamped by `trace()`
 *   on a terminal phase); `startedAt` is derived as `ts - durationMs` so the
 *   entry's `createdAt` reflects the span's START, not the time this terminal
 *   event fired — required for `buildWaterfall`'s time-interval containment
 *   to nest spans correctly. Falls back to the terminal `ts` itself (a
 *   zero-length span) on the defensive path where `durationMs` is absent.
 * - `traceId` is passed EXPLICITLY on `RecordInput` (GAP 1 fix, honored by the
 *   core Recorder with explicit-wins-over-ambient precedence — see
 *   `RecordInput.traceId` (telescope core 1.17+)) rather than relying on ambient OTel/context
 *   enrichment, which may not correlate with the diagnostics `traceId` at all.
 */
export function buildDiagnosticSpanEntry(
  msg: SpanEvent,
): RecordInput<DiagnosticSpanEntryContent> {
  const durationMs = msg.durationMs;
  const startedAt = new Date(typeof durationMs === 'number' ? msg.ts - durationMs : msg.ts);
  const content: DiagnosticSpanEntryContent = {
    v: msg.v ?? null,
    lib: msg.lib,
    event: msg.event,
    ts: msg.ts,
    traceId: msg.traceId ?? null,
    spanId: msg.spanId,
    phase: msg.phase,
    ...(msg.phase === 'error' ? { error: msg.error } : { result: msg.result }),
  };
  return {
    type: DIAGNOSTIC_ENTRY_TYPE,
    // Same family-hash convention as point traffic so a span-only (lib, event)
    // pair still rolls up in "Busiest events" — one recorded entry per
    // completed span, keeping the count directly comparable to `emit()`'s one
    // entry per call (see the class doc's "Point vs span" section).
    familyHash: `${msg.lib}:${msg.event}`,
    tags: [
      `lib:${msg.lib}`,
      `event:${msg.event}`,
      'kind:span',
      ...(msg.traceId ? [`trace:${msg.traceId}`] : []),
    ],
    content,
    startedAt,
    ...(durationMs !== undefined && { durationMs }),
    ...(msg.traceId !== undefined && { traceId: msg.traceId }),
  };
}

/** Strict structural validation of a span envelope. */
export function isSpanEvent(msg: unknown): msg is SpanEvent {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.ts === 'number' &&
    typeof m.lib === 'string' &&
    typeof m.event === 'string' &&
    typeof m.spanId === 'string' &&
    isSpanPhase(m.phase) &&
    (m.traceId === undefined || typeof m.traceId === 'string') &&
    (m.durationMs === undefined || typeof m.durationMs === 'number') &&
    // Tolerate legacy envelopes without `v`; reject a malformed (non-number) one.
    (m.v === undefined || typeof m.v === 'number')
  );
}

/** Narrow an unknown `phase` field to the {@link SpanPhase} union. */
function isSpanPhase(phase: unknown): phase is SpanPhase {
  return (
    phase === 'start' ||
    phase === 'end' ||
    phase === 'asyncStart' ||
    phase === 'asyncEnd' ||
    phase === 'error'
  );
}
