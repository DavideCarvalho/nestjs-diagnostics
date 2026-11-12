import type { DiagnosticEvent, EventOf, LibOf, PayloadOf } from '../types.js';

/** Metadata key under which a method's @OnDiagnostic subscriptions accumulate. */
export const ON_DIAGNOSTIC_META = Symbol('diagnostics:on');

/** Which events of a lib a listener receives: one exact name, a pattern, or every event. */
export type ListenerEventMatcher = string | RegExp | undefined;

/** One subscription declared on a method. `event` omitted = every event of `lib`. */
export interface OnDiagnosticMeta {
  lib: string;
  event?: string | RegExp;
}

/** The envelope a listener for `(TLib, TEvent)` receives, typed from the `ChannelRegistry`. */
export type DiagnosticEventOf<TLib extends string, TEvent extends string> = DiagnosticEvent<
  PayloadOf<TLib, TEvent>
>;

/**
 * What a listener's parameter must accept: the registered envelope for a channel declared in the
 * `ChannelRegistry`; any envelope otherwise, so handlers on untyped channels keep annotating their
 * own payload type.
 */
// biome-ignore lint/suspicious/noExplicitAny: an untyped channel accepts any handler parameter
type AnyEvent = DiagnosticEvent<any>;
type ListenerEventOf<TLib extends string, TEvent extends string> = unknown extends PayloadOf<
  TLib,
  TEvent
>
  ? AnyEvent
  : DiagnosticEventOf<TLib, TEvent>;

type ListenerMethod<TEvent> = (event: TEvent) => unknown;

/**
 * The decorator {@link OnDiagnostic} returns. The decorated method's parameter must accept
 * `TEvent`, so a channel declared in the `ChannelRegistry` checks the handler's payload type.
 */
export type ListenerMethodDecorator<TEvent> = <M extends ListenerMethod<TEvent>>(
  target: object,
  key: string | symbol,
  descriptor: TypedPropertyDescriptor<M>,
) => void;

/**
 * Make a provider method a diagnostics listener. Requires `DiagnosticsModule.forRoot()`.
 *
 * - `@OnDiagnostic('resilience', 'circuit-opened')`: the exact channel.
 * - `@OnDiagnostic('durable', /^run\./)`: every event of the lib whose name matches.
 * - `@OnDiagnostic('resilience')`: every `aviary:resilience:*` channel (current and future).
 *
 * The listener id is `<ClassName>#<method>`. Delivering transports route work by it, so keep it
 * stable while deliveries may be pending. Stackable: one method can listen to several channels
 * and keeps one id.
 *
 * For a channel declared in the `ChannelRegistry`, the handler's parameter is checked against
 * {@link DiagnosticEventOf}.
 */
export function OnDiagnostic<TLib extends LibOf>(lib: TLib): ListenerMethodDecorator<AnyEvent>;
export function OnDiagnostic<TLib extends LibOf, TEvent extends EventOf<TLib>>(
  lib: TLib,
  event: TEvent,
): ListenerMethodDecorator<ListenerEventOf<TLib, TEvent>>;
export function OnDiagnostic<TLib extends LibOf>(
  lib: TLib,
  event: RegExp,
): ListenerMethodDecorator<AnyEvent>;
export function OnDiagnostic(
  lib: string,
  event?: string | RegExp,
): ListenerMethodDecorator<DiagnosticEvent<never>> {
  return (target, key) => {
    const existing =
      (Reflect.getMetadata(ON_DIAGNOSTIC_META, target, key) as OnDiagnosticMeta[] | undefined) ??
      [];
    const meta: OnDiagnosticMeta = { lib, ...(event !== undefined ? { event } : {}) };
    Reflect.defineMetadata(ON_DIAGNOSTIC_META, [...existing, meta], target, key);
  };
}
