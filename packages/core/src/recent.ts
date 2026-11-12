import diagnostics_channel from 'node:diagnostics_channel';
import { CHANNEL_PREFIX } from './channel.js';
import {
  OFFICIAL_CHANNELS,
  type OfficialDiagnosticEvent,
  type OfficialLib,
  officialChannelNames,
  subscribeOfficial,
} from './official.js';
import { onChannelRegistered, registeredChannels } from './registry.js';
import type { DiagnosticEvent, SpanEvent, SpanPhase } from './types.js';

/** Default number of events the recent-events buffer keeps. */
export const DEFAULT_RECENT_SIZE = 500;

/** Bytes of serialized payload kept per buffered event. */
export const RECENT_PAYLOAD_BYTES = 2048;

/** One event in the recent-events buffer: the envelope, with its payload bounded and redacted. */
export interface RecentEvent {
  id?: string;
  ts: number;
  lib: string;
  event: string;
  traceId?: string;
  durationMs?: number;
  /** `'nestjs'` for an event of a first-party `nestjs:*` channel. Absent on `aviary:*` events. */
  source?: 'nestjs';
  /** The payload with secret-looking keys replaced, or a `{ truncated, bytes, preview }` cut. */
  payload: unknown;
  /** For `trace()` spans: the phase (`start`, `end`, `asyncEnd`, `error`). Absent on `emit` events. */
  phase?: SpanPhase;
  /** For `trace()` spans: the id every phase of one span shares. */
  spanId?: string;
  /** For a span's `end`/`asyncEnd`: the result, bounded like `payload`. */
  result?: unknown;
  /** For a span's `error` (or failed `asyncEnd`): the error's name and message. */
  error?: { name?: string; message: string };
}

/** Filters for {@link recentEvents}. */
export interface RecentEventsFilter {
  lib?: string;
  /** An exact event name, or a RegExp (the string form `/run\./` is accepted too). */
  event?: string | RegExp;
  traceId?: string;
  /** How many of the newest matches to return (default 20). */
  limit?: number;
  /** Skip this many of the newest matches first (paging). */
  offset?: number;
}

/** The span phases the buffer keeps (`asyncStart` carries nothing of its own). */
export const RECENT_SPAN_PHASES: readonly SpanPhase[] = ['start', 'end', 'asyncEnd', 'error'];

const SECRET_KEY =
  /(secret|token|password|passwd|authorization|cookie|api[_-]?key|credential|private[_-]?key)/i;
const MAX_DEPTH = 8;

function describeError(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 500) };
  return { message: String(error).slice(0, 500) };
}

/** A JSON-safe copy of `value` with secret-looking keys replaced by `'[redacted]'`. */
function redact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return describeError(value);
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[…]';
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    try {
      return redact(toJSON.call(value), depth + 1, seen);
    } catch {
      return '[unserializable]';
    }
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));
    if (value instanceof Map) {
      return redact(Object.fromEntries(value), depth, seen);
    }
    if (value instanceof Set) return redact([...value], depth, seen);
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(inner, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * A payload as the buffer keeps it: secret-looking keys (`password`, `token`, `authorization`,
 * `cookie`, `apiKey`, …) redacted, and cut to {@link RECENT_PAYLOAD_BYTES} of JSON.
 */
export function boundPayload(payload: unknown): unknown {
  let safe: unknown;
  let json: string | undefined;
  try {
    safe = redact(payload, 0, new WeakSet());
    json = JSON.stringify(safe);
  } catch {
    return '[unserializable]';
  }
  if (json === undefined) return undefined;
  const bytes = Buffer.byteLength(json);
  if (bytes <= RECENT_PAYLOAD_BYTES) return safe;
  return {
    truncated: true,
    bytes,
    preview: `${Buffer.from(json).subarray(0, RECENT_PAYLOAD_BYTES).toString('utf8')}…`,
  };
}

/** `'run.done'` → exact match; `/run\./` (RegExp or its string form) → test. */
function toMatcher(event: string | RegExp | undefined): ((name: string) => boolean) | undefined {
  if (event === undefined || event === '') return undefined;
  if (event instanceof RegExp) {
    // A caller's /g or /y pattern keeps `lastIndex` between calls: compile a stateless copy.
    const pattern = new RegExp(event.source, event.flags.replace(/[gy]/g, ''));
    return (name) => pattern.test(name);
  }
  const literal = /^\/(.+)\/([a-z]*)$/.exec(event);
  if (literal) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(literal[1] as string, (literal[2] ?? '').replace(/[gy]/g, ''));
    } catch {
      throw new Error(`invalid event pattern ${event}`);
    }
    return (name) => pattern.test(name);
  }
  return (name) => name === event;
}

/**
 * A fixed-size ring of the last events published in this process: every `aviary:*` channel (the
 * `emit()` events and the `trace()` span phases) and every first-party `nestjs:*` channel.
 *
 * Subscribing to every channel turns off `emit`'s no-subscriber fast path, so the buffer only runs
 * where it is wanted: `DiagnosticsModule` starts it outside production unless `recent: false`.
 */
export class RecentEventsBuffer {
  readonly size: number;
  #ring: Array<RecentEvent | undefined>;
  #next = 0;
  #count = 0;
  #subscribed: Array<{ name: string; listener: (message: unknown) => void }> = [];
  #names = new Set<string>();
  #offOfficial: Array<() => void> = [];
  #offRegistered: (() => void) | null = null;

  constructor(size = DEFAULT_RECENT_SIZE) {
    if (!Number.isInteger(size) || size < 1) {
      throw new Error(
        `@dudousxd/nestjs-diagnostics: recent.size must be a positive integer (got ${String(size)})`,
      );
    }
    this.size = size;
    this.#ring = new Array(size);
  }

  /** Whether the buffer is subscribed to the bus. */
  get started(): boolean {
    return this.#offRegistered !== null;
  }

  /** How many events are buffered. */
  get count(): number {
    return this.#count;
  }

  /**
   * Subscribe to every current and future `aviary:*` channel with its `trace()` span sub-channels
   * (`:start`, `:end`, `:asyncEnd`, `:error`), and to every first-party `nestjs:*` channel.
   * Idempotent.
   */
  start(): void {
    if (this.started) return;
    const listen = (name: string) => {
      const listener = (message: unknown) => this.push(message as DiagnosticEvent | SpanEvent);
      diagnostics_channel.channel(name).subscribe(listener);
      this.#subscribed.push({ name, listener });
      this.#names.add(name);
    };
    const subscribe = (name: string) => {
      if (!name.startsWith(`${CHANNEL_PREFIX}:`)) return;
      listen(name);
      for (const phase of RECENT_SPAN_PHASES) listen(`${name}:${phase}`);
    };
    for (const name of registeredChannels()) subscribe(name);
    this.#offRegistered = onChannelRegistered(subscribe);
    for (const lib of Object.keys(OFFICIAL_CHANNELS) as OfficialLib[]) {
      this.#offOfficial.push(subscribeOfficial(lib, 'all', (event) => this.push(event)));
    }
    for (const name of officialChannelNames()) this.#names.add(name);
  }

  /** Unsubscribe from the bus. The buffered events stay readable. */
  stop(): void {
    this.#offRegistered?.();
    this.#offRegistered = null;
    for (const { name, listener } of this.#subscribed) {
      diagnostics_channel.channel(name).unsubscribe(listener);
    }
    this.#subscribed = [];
    for (const off of this.#offOfficial) off();
    this.#offOfficial = [];
    this.#names.clear();
  }

  /** Whether this buffer is one of the subscribers of channel `name`. */
  isSubscribedTo(name: string): boolean {
    return this.#names.has(name);
  }

  /** Record one envelope (normally called by the bus subscription). Never throws. */
  push(envelope: DiagnosticEvent | SpanEvent | OfficialDiagnosticEvent): void {
    try {
      if (envelope === null || typeof envelope !== 'object') return;
      if (typeof envelope.lib !== 'string' || typeof envelope.event !== 'string') return;
      const span = 'phase' in envelope && typeof envelope.phase === 'string' ? envelope : null;
      const source = 'source' in envelope && envelope.source === 'nestjs' ? 'nestjs' : undefined;
      const entry: RecentEvent = {
        ...(typeof envelope.id === 'string' ? { id: envelope.id } : {}),
        ts: typeof envelope.ts === 'number' ? envelope.ts : Date.now(),
        lib: envelope.lib,
        event: envelope.event,
        ...(typeof envelope.traceId === 'string' ? { traceId: envelope.traceId } : {}),
        ...(typeof envelope.durationMs === 'number' ? { durationMs: envelope.durationMs } : {}),
        ...(source !== undefined ? { source } : {}),
        payload: boundPayload(envelope.payload),
        ...(span !== null ? { phase: span.phase, spanId: span.spanId } : {}),
        ...(span !== null && span.result !== undefined
          ? { result: boundPayload(span.result) }
          : {}),
        ...(span !== null && span.error !== undefined ? { error: describeError(span.error) } : {}),
      };
      this.#ring[this.#next] = entry;
      this.#next = (this.#next + 1) % this.size;
      this.#count = Math.min(this.#count + 1, this.size);
    } catch {
      // Recording must never break an emitter.
    }
  }

  /** The newest events matching `filter`, newest first. */
  list(filter: RecentEventsFilter = {}): RecentEvent[] {
    const limit = Math.max(1, Math.floor(filter.limit ?? 20));
    let skip = Math.max(0, Math.floor(filter.offset ?? 0));
    const event = toMatcher(filter.event);
    const out: RecentEvent[] = [];
    for (let i = 1; i <= this.#count && out.length < limit; i++) {
      const entry = this.#ring[(this.#next - i + this.size) % this.size];
      if (entry === undefined) continue;
      if (filter.lib !== undefined && entry.lib !== filter.lib) continue;
      if (filter.traceId !== undefined && entry.traceId !== filter.traceId) continue;
      if (event !== undefined && !event(entry.event)) continue;
      if (skip > 0) {
        skip--;
        continue;
      }
      out.push(entry);
    }
    return out;
  }

  /** Drop every buffered event. */
  clear(): void {
    this.#ring = new Array(this.size);
    this.#next = 0;
    this.#count = 0;
  }
}

/**
 * The process-wide buffer lives on `globalThis` (like the channel registry), so every copy of this
 * package loaded in one process reads the same one.
 */
const RECENT_KEY = Symbol.for('@dudousxd/nestjs-diagnostics:recent');
type RecentHolder = typeof globalThis & { [RECENT_KEY]?: RecentEventsBuffer | null };

function active(): RecentEventsBuffer | null {
  return (globalThis as RecentHolder)[RECENT_KEY] ?? null;
}

/**
 * Start the process-wide recent-events buffer and return it. `DiagnosticsModule` calls this; call
 * it yourself only without the module. Starting again with the same size keeps the buffered
 * events; another size replaces the buffer.
 */
export function startRecentEvents(size = DEFAULT_RECENT_SIZE): RecentEventsBuffer {
  const current = active();
  if (current !== null && current.size === size) {
    current.start();
    return current;
  }
  current?.stop();
  const buffer = new RecentEventsBuffer(size);
  buffer.start();
  (globalThis as RecentHolder)[RECENT_KEY] = buffer;
  return buffer;
}

/** Stop the process-wide buffer and forget it. */
export function stopRecentEvents(): void {
  active()?.stop();
  (globalThis as RecentHolder)[RECENT_KEY] = null;
}

/** The process-wide buffer, or `null` when it is not running. */
export function recentEventsBuffer(): RecentEventsBuffer | null {
  return active();
}

/**
 * The last diagnostics events of this process, newest first, when the recent-events buffer runs
 * (outside production with `DiagnosticsModule`, or wherever `recent` turns it on). `[]` otherwise.
 *
 * ```ts
 * recentEvents({ lib: 'durable', event: /run\.(failed|cancelled)/, limit: 50 });
 * ```
 */
export function recentEvents(filter?: RecentEventsFilter): RecentEvent[] {
  return active()?.list(filter) ?? [];
}
