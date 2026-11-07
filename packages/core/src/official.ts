import diagnostics_channel from 'node:diagnostics_channel';
import { SCHEMA_VERSION } from './channel.js';
import { resolveTraceId } from './context-accessor.js';
import type { DiagnosticEvent } from './types.js';

/**
 * The first-party NestJS packages publish raw events on `node:diagnostics_channel`
 * under the fixed convention `nestjs:<lib>:<type>`: no envelope, no traceId. This
 * file is the ONE place their channel lists live. Each list was read from the
 * published tarball of the version in {@link OFFICIAL_PACKAGE_VERSIONS}, and
 * `test/official.spec.ts` re-reads the installed (pinned) packages and fails when
 * a channel is added, renamed or removed.
 *
 * Aviary never publishes on `nestjs:*`. It only subscribes, through
 * {@link subscribeOfficial}. `aviary:*` is for what the official packages don't emit.
 */
export const OFFICIAL_CHANNEL_PREFIX = 'nestjs';

/** `nestjs:<lib>:<type>`, the first-party channel name. */
export type OfficialChannelName<L extends string, T extends string> = `nestjs:${L}:${T}`;

type ChannelMap<L extends string, T extends readonly string[]> = {
  readonly [K in T[number]]: OfficialChannelName<L, K>;
};

function channelsOf<L extends string, const T extends readonly string[]>(
  lib: L,
  types: T,
): ChannelMap<L, T> {
  return Object.freeze(
    Object.fromEntries(types.map((type) => [type, `${OFFICIAL_CHANNEL_PREFIX}:${lib}:${type}`])),
  ) as ChannelMap<L, T>;
}

/** `@nestjs/resilience`: the 9 fixed channels of `events/resilience.channels.js`. */
export const NESTJS_RESILIENCE_CHANNELS = channelsOf('resilience', [
  'retry',
  'timeout',
  'circuit-open',
  'circuit-half-open',
  'circuit-closed',
  'circuit-rejected',
  'bulkhead-rejected',
  'rate-limited',
  'fallback',
]);

/** `@nestjs/workflows`: `channelFor(event.type)` over the 19 `WorkflowEvent` types. */
export const NESTJS_WORKFLOWS_CHANNELS = channelsOf('workflows', [
  'workflow-started',
  'workflow-resumed',
  'workflow-suspended',
  'workflow-compensating',
  'workflow-completed',
  'workflow-failed',
  'workflow-cancelled',
  'workflow-compensation-failed',
  'step-completed',
  'step-failed',
  'step-compensated',
  'child-started',
  'signal-received',
  'signal-timed-out',
  'journal-large',
  'custom-status',
  'workflow-retried',
  'workflow-deleted',
  'schedule-skipped',
]);

/** `@nestjs/authentication`: `channelFor(event.type)` over the 13 `AuthenticationEvent` types. */
export const NESTJS_AUTHENTICATION_CHANNELS = channelsOf('authentication', [
  'sign-in',
  'sign-out',
  'mfa-verified',
  'mfa-failed',
  'mfa-enabled',
  'mfa-disabled',
  'recovery-codes-generated',
  'refresh-token-reused',
  'password-reset-requested',
  'password-reset',
  'email-verified',
  'magic-link-refused',
  'session-touch-failed',
]);

/** `@nestjs/authorization`: the single `deniedChannel`. */
export const NESTJS_AUTHORIZATION_CHANNELS = channelsOf('authorization', ['denied']);

/** `@nestjs/mail`: `channels.sent` and `channels.failed`. */
export const NESTJS_MAIL_CHANNELS = channelsOf('mail', ['sent', 'failed']);

/** Every known first-party lib → its `type → channel name` map. */
export const OFFICIAL_CHANNELS = Object.freeze({
  resilience: NESTJS_RESILIENCE_CHANNELS,
  workflows: NESTJS_WORKFLOWS_CHANNELS,
  authentication: NESTJS_AUTHENTICATION_CHANNELS,
  authorization: NESTJS_AUTHORIZATION_CHANNELS,
  mail: NESTJS_MAIL_CHANNELS,
});

/** The official package version each list above was verified against. */
export const OFFICIAL_PACKAGE_VERSIONS = Object.freeze({
  resilience: '0.0.3',
  workflows: '0.0.5',
  authentication: '0.1.5',
  authorization: '0.1.3',
  mail: '0.0.2',
} satisfies Record<OfficialLib, string>);

/** A first-party lib whose channels are listed here. */
export type OfficialLib = keyof typeof OFFICIAL_CHANNELS;

/** The event types `L` publishes, e.g. `'retry' | 'timeout' | …` for `'resilience'`. */
export type OfficialType<L extends OfficialLib> = keyof (typeof OFFICIAL_CHANNELS)[L] & string;

/** Every first-party channel name, flattened. */
export function officialChannelNames(): string[] {
  return Object.values(OFFICIAL_CHANNELS).flatMap((map) => Object.values(map) as string[]);
}

/**
 * The Aviary envelope wrapped around an official payload: the usual
 * {@link DiagnosticEvent} plus `source: 'nestjs'`, so an observer that records
 * both kinds (Telescope's `DiagnosticWatcher`) can tell them apart. Aviary's own
 * `emit()` envelopes carry no `source`.
 */
export interface OfficialDiagnosticEvent<TPayload = unknown> extends DiagnosticEvent<TPayload> {
  source: 'nestjs';
}

/** Receives each wrapped official event and the `nestjs:*` channel it came from. */
export type OfficialListener = (event: OfficialDiagnosticEvent, channel: string) => void;

/**
 * Subscribe to first-party `nestjs:<lib>:<type>` channels and receive each raw
 * payload wrapped in the Aviary envelope `{ v, ts, lib, event, traceId, payload,
 * source: 'nestjs' }`:
 *
 * - `traceId` comes from the registered context accessor. Official publishers run
 *   subscribers synchronously in the caller's async context, so it is the
 *   request's traceId;
 * - `durationMs` is copied from the payload when it carries a numeric one
 *   (e.g. workflows' `step-completed`).
 *
 * Returns an unsubscribe function. A throwing `fn` never reaches the official
 * publisher. Subscribing only reads `nestjs:*`; Aviary never publishes there.
 *
 * ```ts
 * const off = subscribeOfficial('resilience', ['retry', 'circuit-open'], (e) => log(e));
 * subscribeOfficial('authentication', 'all', record);
 * ```
 */
export function subscribeOfficial<L extends OfficialLib>(
  lib: L,
  types: readonly OfficialType<L>[] | 'all',
  fn: OfficialListener,
): () => void {
  const map = OFFICIAL_CHANNELS[lib] as Readonly<Record<string, string>> | undefined;
  if (!map) {
    throw new TypeError(`subscribeOfficial: unknown first-party lib '${String(lib)}'`);
  }
  const selected = types === 'all' ? Object.keys(map) : [...new Set(types)];
  const subscriptions: Array<[string, (message: unknown) => void]> = [];
  for (const type of selected) {
    const name = map[type];
    if (name === undefined) {
      throw new TypeError(`subscribeOfficial: '${lib}' publishes no '${type}' channel`);
    }
    const listener = (message: unknown): void => {
      try {
        const duration = (message as { durationMs?: unknown } | null)?.durationMs;
        const event: OfficialDiagnosticEvent = {
          v: SCHEMA_VERSION,
          ts: Date.now(),
          lib,
          event: type,
          traceId: resolveTraceId(),
          payload: message,
          source: 'nestjs',
          ...(typeof duration === 'number' && { durationMs: duration }),
        };
        fn(event, name);
      } catch {
        // An observer must never change the outcome of the call it observes.
      }
    };
    diagnostics_channel.subscribe(name, listener);
    subscriptions.push([name, listener]);
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const [name, listener] of subscriptions) {
      diagnostics_channel.unsubscribe(name, listener);
    }
  };
}
