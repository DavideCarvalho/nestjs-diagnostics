/**
 * The listener delivery contract. Types only: a transport package (such as
 * `@dudousxd/nestjs-durable-diagnostics`) implements it with `import type` and never loads
 * diagnostics at runtime.
 *
 * Lifecycle, in every process that boots `DiagnosticsModule` with a delivering transport selected:
 *
 * 1. At bootstrap, after listeners are discovered, the transport is created with a
 *    {@link DeliveryTransportContext}. Unless `role` is `'api'`, it must also set up whatever runs
 *    deliveries (a worker, a workflow) in THIS process, because any process may run them.
 * 2. When a process emits an event that matches listeners, diagnostics calls
 *    {@link ListenerDeliveryTransport.deliver} in that process only, once per matching listener,
 *    off the emitter's call stack, batched per event loop turn, in emit order. Copies of the event
 *    that reached other processes through a relay are never delivered again.
 * 3. Wherever the transport runs a delivery, it calls {@link DeliveryTransportContext.invoke}
 *    `(listenerId, envelope)`. The promise settles when the handler finishes and rejects with the
 *    handler's own error, so the transport can retry.
 * 4. On application shutdown, diagnostics awaits {@link ListenerDeliveryTransport.stop}.
 */
import type { ModuleRef } from '@nestjs/core';
import type { DiagnosticEvent } from '../types.js';
import type { DiagnosticsRole } from './role.js';

/** An envelope handed to a delivering transport: `id` is always set. */
export type DeliveredEvent<TPayload = unknown> = DiagnosticEvent<TPayload> & { id: string };

/** One unit of work: run listener `listenerId` for `envelope`. */
export interface ListenerDelivery {
  /** Stable listener id, `<ClassName>#<method>`. The same in every process running the same app. */
  listenerId: string;
  /**
   * The event, as emitted. `diag:<envelope.id>:<listenerId>` identifies this delivery uniquely:
   * use it as the idempotency key.
   */
  envelope: DeliveredEvent;
}

/**
 * Run listener `listenerId` for `envelope` in this process. Resolves when the handler finishes;
 * rejects with the handler's error (retry it), or with an `UnknownDiagnosticListenerError`
 * (`code: 'E_UNKNOWN_DIAGNOSTICS_LISTENER'`) when this process has no listener with that id.
 */
export type ListenerInvoker = (listenerId: string, envelope: DiagnosticEvent) => Promise<void>;

/** What a delivering transport receives when diagnostics creates it at bootstrap. */
export interface DeliveryTransportContext {
  /** The application's module ref, to resolve providers. */
  moduleRef: ModuleRef;
  /** Id of this process (`nodeId` in the diagnostics options, or a random one). */
  nodeId: string;
  /** Which half of a split deployment this process is. On `'api'`, never run deliveries here. */
  role: DiagnosticsRole;
  /** Runs a listener in this process. See {@link ListenerInvoker}. */
  invoke: ListenerInvoker;
  /** Ids of the listeners registered in this process. */
  listenerIds: readonly string[];
}

/** A transport that owns listener execution (`queue`, `durable`). */
export interface ListenerDeliveryTransport {
  /**
   * Take ownership of these deliveries. Called only in the emitting process. Return (or resolve)
   * once they are safely stored; a throw or rejection is logged and those deliveries are lost.
   */
  deliver(deliveries: readonly ListenerDelivery[]): void | Promise<void>;
  /** Release resources on shutdown. Awaited. */
  stop?(): void | Promise<void>;
}

/** Options of `transports.durable()`, passed to the durable step that runs each listener. */
export interface DurableTransportConfig {
  /** Max attempts of a listener before its run fails. */
  retries?: number;
  /** How the delay between attempts grows: constant (`fixed`) or doubling (`exp`). */
  backoff?: 'fixed' | 'exp';
  /** Base delay between attempts, in ms. */
  backoffMs?: number;
  /** Upper bound of the exponential delay, in ms. */
  backoffMaxMs?: number;
  /** Add random jitter to the delay. */
  jitter?: boolean;
}

/**
 * What `@dudousxd/nestjs-durable-diagnostics/delivery` must export (as named exports) for
 * `transports.durable()`. Diagnostics imports it only when durable is the selected transport.
 */
export interface DurableDiagnosticsDeliveryModule {
  /**
   * Whether durable is set up in this app (its engine resolves from `moduleRef`). Called at
   * bootstrap, before {@link createDeliveryTransport}; `false` fails the bootstrap.
   */
  isConfigured(moduleRef: ModuleRef): boolean | Promise<boolean>;
  /** Create the delivering transport. Called once per process, at bootstrap. */
  createDeliveryTransport(
    context: DeliveryTransportContext,
    config: DurableTransportConfig,
  ): ListenerDeliveryTransport | Promise<ListenerDeliveryTransport>;
}
