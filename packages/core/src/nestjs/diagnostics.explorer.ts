import { randomUUID } from 'node:crypto';
import diagnostics_channel from 'node:diagnostics_channel';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { CHANNEL_PREFIX, channelName } from '../channel.js';
import { onChannelRegistered, registeredChannels } from '../registry.js';
import { isRelayed } from '../relayed.js';
import type { DiagnosticEvent } from '../types.js';
import type { DeliveredEvent, ListenerDelivery, ListenerInvoker } from './delivery.js';
import { DIAGNOSTICS_OPTIONS, type DiagnosticsModuleOptions } from './diagnostics.options.js';
import { ON_DIAGNOSTIC_META, type OnDiagnosticMeta } from './on-diagnostic.decorator.js';
import { type DiagnosticsRole, resolveRole } from './role.js';
import type { TransportHandle } from './transports.js';

/** Thrown by the listener invoker for a listener id this process does not know. */
export class UnknownDiagnosticListenerError extends Error {
  readonly code = 'E_UNKNOWN_DIAGNOSTICS_LISTENER';
  constructor(readonly listenerId: string) {
    super(
      `@dudousxd/nestjs-diagnostics: no listener "${listenerId}" is registered in this process. Every process that runs deliveries must register the same listeners.`,
    );
  }
}

/** A discovered `@OnDiagnostic` method. */
export interface RegisteredListener {
  /** Stable id, `<ClassName>#<method>`. */
  readonly id: string;
  /** Where it listens (one entry per stacked decorator). */
  readonly matchers: readonly OnDiagnosticMeta[];
  readonly instance: Record<string, unknown>;
  readonly method: string;
}

function matches(meta: OnDiagnosticMeta, lib: string, event: string): boolean {
  if (meta.lib !== lib) return false;
  const matcher = meta.event;
  if (matcher === undefined) return true;
  if (typeof matcher === 'string') return matcher === event;
  matcher.lastIndex = 0;
  return matcher.test(event);
}

/** A diagnostics POINT event (from `emit`). Span phase events from `trace` are never dispatched. */
function isPointEvent(msg: unknown): msg is DiagnosticEvent {
  if (typeof msg !== 'object' || msg === null) return false;
  const env = msg as Partial<DiagnosticEvent> & { phase?: unknown; spanId?: unknown };
  if (typeof env.lib !== 'string' || typeof env.event !== 'string') return false;
  return env.phase === undefined || env.spanId === undefined;
}

function libOf(name: string): string | undefined {
  if (!name.startsWith(`${CHANNEL_PREFIX}:`)) return undefined;
  const rest = name.slice(CHANNEL_PREFIX.length + 1);
  const idx = rest.indexOf(':');
  return idx > 0 ? rest.slice(0, idx) : undefined;
}

/**
 * Discovers `@OnDiagnostic` methods, starts the `default` transport and routes every matching
 * event: to the delivering transport (only in the emitting process), or straight to the handler.
 */
@Injectable()
export class DiagnosticsExplorer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DiagnosticsExplorer');
  private readonly listeners = new Map<string, RegisteredListener>();
  private readonly matchCache = new Map<string, RegisteredListener[]>();
  private readonly subscribed = new Set<string>();
  private readonly wildcardLibs = new Set<string>();
  private readonly pending: ListenerDelivery[] = [];
  private scheduled: ReturnType<typeof setImmediate> | null = null;
  private offChannelRegistered: (() => void) | null = null;
  private transport: TransportHandle | null = null;
  private deliver: TransportHandle['deliver'] | null = null;
  private role: DiagnosticsRole = 'all';
  private readonly options: DiagnosticsModuleOptions;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Optional() @Inject(DIAGNOSTICS_OPTIONS) options?: DiagnosticsModuleOptions,
  ) {
    this.options = options ?? {};
  }

  /**
   * Run listener `listenerId` for `envelope` in this process. The handler is called synchronously;
   * the promise rejects with its error.
   */
  readonly invoke: ListenerInvoker = (listenerId, envelope) => {
    const listener = this.listeners.get(listenerId);
    if (!listener) return Promise.reject(new UnknownDiagnosticListenerError(listenerId));
    try {
      const fn = listener.instance[listener.method] as (e: DiagnosticEvent) => unknown;
      return Promise.resolve(fn.call(listener.instance, envelope)).then(() => undefined);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  /** Every listener discovered in this process. */
  registeredListeners(): RegisteredListener[] {
    return [...this.listeners.values()];
  }

  async onApplicationBootstrap(): Promise<void> {
    this.role = resolveRole(this.options.role, this.options.default);
    this.discover();

    const name = this.options.default;
    if (name) {
      const provider = this.options.transports?.[name];
      if (!provider) {
        throw new Error(
          `@dudousxd/nestjs-diagnostics: default is "${name}", but transports.${name} is not defined`,
        );
      }
      const listeners = this.registeredListeners();
      this.transport = await provider({
        moduleRef: this.moduleRef,
        role: this.role,
        nodeId: this.options.nodeId ?? randomUUID(),
        listenerLibs: [...new Set(listeners.flatMap((l) => l.matchers.map((m) => m.lib)))],
        listenerIds: listeners.map((l) => l.id),
        invoke: this.invoke,
        logger: this.logger,
      });
      this.deliver = this.transport.deliver?.bind(this.transport) ?? null;
    }

    // An 'api' process without a delivering transport has nothing to do with its listeners.
    if (this.role === 'api' && !this.deliver) return;
    this.subscribeListeners();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
    this.offChannelRegistered?.();
    this.offChannelRegistered = null;
    for (const name of this.subscribed) diagnostics_channel.channel(name).unsubscribe(this.onEvent);
    this.subscribed.clear();
    this.wildcardLibs.clear();
    const transport = this.transport;
    this.transport = null;
    this.deliver = null;
    try {
      await transport?.stop?.();
    } catch (error) {
      this.logger.error(`failed to stop the diagnostics transport: ${messageOf(error)}`);
    }
  }

  private discover(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const method of this.scanner.getAllMethodNames(proto)) {
        const metas = Reflect.getMetadata(ON_DIAGNOSTIC_META, proto, method) as
          | OnDiagnosticMeta[]
          | undefined;
        if (!metas?.length) continue;
        const id = `${instance.constructor.name}#${method}`;
        const existing = this.listeners.get(id);
        if (existing) {
          if (existing.instance.constructor === instance.constructor) continue;
          throw new Error(
            `@dudousxd/nestjs-diagnostics: two listeners share the id "${id}". Listener ids are <ClassName>#<method> and must be unique; rename one class.`,
          );
        }
        this.listeners.set(id, { id, matchers: metas, instance, method });
      }
    }
    this.matchCache.clear();
  }

  /** The listeners that receive an event on `aviary:<lib>:<event>`. */
  private listenersFor(lib: string, event: string): RegisteredListener[] {
    const key = `${lib}\0${event}`;
    let hit = this.matchCache.get(key);
    if (hit === undefined) {
      hit = this.registeredListeners().filter((l) =>
        l.matchers.some((m) => matches(m, lib, event)),
      );
      this.matchCache.set(key, hit);
    }
    return hit;
  }

  private subscribeListeners(): void {
    for (const listener of this.listeners.values()) {
      for (const meta of listener.matchers) {
        if (typeof meta.event === 'string') {
          this.subscribe(channelName(meta.lib, meta.event));
        } else if (!this.wildcardLibs.has(meta.lib)) {
          this.wildcardLibs.add(meta.lib);
          for (const name of registeredChannels()) {
            if (libOf(name) === meta.lib) this.subscribe(name);
          }
        }
      }
    }
    this.offChannelRegistered = onChannelRegistered((name) => {
      const lib = libOf(name);
      if (lib !== undefined && this.wildcardLibs.has(lib)) this.subscribe(name);
    });
  }

  private subscribe(name: string): void {
    if (this.subscribed.has(name)) return;
    diagnostics_channel.channel(name).subscribe(this.onEvent);
    this.subscribed.add(name);
  }

  private readonly onEvent = (msg: unknown): void => {
    if (!isPointEvent(msg)) return;
    const matched = this.listenersFor(msg.lib, msg.event);
    if (matched.length === 0) return;
    if (this.deliver) {
      // Delivery happens once, at the origin. A relayed copy was already handed over there.
      if (isRelayed(msg)) return;
      const envelope = (
        typeof msg.id === 'string' ? msg : { ...msg, id: randomUUID() }
      ) as DeliveredEvent;
      for (const listener of matched) this.pending.push({ listenerId: listener.id, envelope });
      this.scheduled ??= setImmediate(() => void this.flush());
      return;
    }
    for (const listener of matched) {
      this.invoke(listener.id, msg).catch((error: unknown) =>
        this.logger.error(`@OnDiagnostic ${listener.id} handler failed: ${messageOf(error)}`),
      );
    }
  };

  /** Hand this turn's deliveries to the transport, in emit order. Settles once they are handed over. */
  private async flush(): Promise<void> {
    if (this.scheduled !== null) {
      clearImmediate(this.scheduled);
      this.scheduled = null;
    }
    if (this.pending.length === 0 || !this.deliver) return;
    const deliveries = this.pending.splice(0);
    const report = (error: unknown) =>
      this.logger.error(
        `failed to hand ${deliveries.length} diagnostics deliveries to the transport: ${messageOf(error)}`,
      );
    try {
      await this.deliver(deliveries);
    } catch (error) {
      report(error);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
