import type { LoggerService } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { type ChannelRef, type RedisLike, createDiagnosticsRedisRelay } from '../redis-relay.js';
import type {
  DurableDiagnosticsDeliveryModule,
  DurableTransportConfig,
  ListenerDelivery,
  ListenerInvoker,
} from './delivery.js';
import type { DiagnosticsRole } from './role.js';

/** What a {@link TransportProvider} receives when `DiagnosticsModule` starts it at bootstrap. */
export interface TransportContext {
  /** The application's module ref, to resolve providers. */
  moduleRef: ModuleRef;
  /** Which half of a split deployment this process is. On `'api'`, never consume or run listeners. */
  role: DiagnosticsRole;
  /** Unique id of THIS process, for echo suppression. */
  nodeId: string;
  /** The libs that have listeners in this process. A broadcasting transport relays them. */
  listenerLibs: readonly string[];
  /** Ids of the listeners registered in this process. */
  listenerIds: readonly string[];
  /** Runs a registered listener in this process; rejects with the handler's error. */
  invoke: ListenerInvoker;
  /** Logger for transport failures. */
  logger: LoggerService;
}

/**
 * A started transport: `stop` for shutdown and, for a delivering transport, `deliver`, which
 * takes over listener execution (see `ListenerDeliveryTransport`).
 */
export interface TransportHandle {
  stop?(): void | Promise<void>;
  deliver?(deliveries: readonly ListenerDelivery[]): void | Promise<void>;
}

/**
 * A configured transport: a thunk `DiagnosticsModule` calls at bootstrap when it is the `default`.
 * Optional dependencies (`bullmq`, durable) are imported inside the thunk, so listing a transport
 * you don't select costs nothing.
 */
export type TransportProvider = (ctx: TransportContext) => Promise<TransportHandle>;

/** Options of `transports.redis()`: Redis pub/sub broadcast. */
export interface RedisTransportConfig {
  /** Publisher connection (an ioredis client). */
  pub: RedisLike;
  /**
   * Subscriber connection, separate from `pub` (for ioredis: `pub.duplicate()`). Required unless
   * `role` is `'api'`, which publishes and never subscribes.
   */
  sub?: RedisLike;
  /** Also forward every event of these libs, for observers in other processes. */
  libs?: string[];
  /** Also forward these exact channels. */
  channels?: ChannelRef[];
  /** Forward every aviary channel. */
  all?: boolean;
  /** Redis channel to relay on. Default `aviary:diagnostics:relay`. */
  redisChannel?: string;
}

/** Options of `transports.queue()`: one BullMQ job per `(listener, event)`. */
export interface QueueTransportConfig {
  /**
   * BullMQ connection: `ConnectionOptions` (`{ host, port }`) or an ioredis client created with
   * `maxRetriesPerRequest: null`.
   */
  connection: object;
  /** Queue name. Default `aviary-diagnostics`. */
  queue?: string;
  /** BullMQ key prefix. Default BullMQ's (`bull`). */
  prefix?: string;
  /** How many times a job is retried after its handler throws. Default `3`. */
  retries?: number;
  /** Delay between attempts. Default `{ type: 'exponential', delay: 1000 }`. */
  backoff?: { type: 'fixed' | 'exponential'; delay: number };
  /** Jobs a worker process runs at once. Default `1`. */
  concurrency?: number;
  /** BullMQ `removeOnComplete`. Default `true`. */
  removeOnComplete?: boolean | number;
  /** BullMQ `removeOnFail`. Default `false` (failed jobs stay for inspection). */
  removeOnFail?: boolean | number;
}

export type { DurableTransportConfig };

export const DURABLE_DELIVERY_MODULE = '@dudousxd/nestjs-durable-diagnostics/delivery';
const DURABLE_PACKAGE = '@dudousxd/nestjs-durable-diagnostics';

export const DURABLE_NOT_INSTALLED = `\`transports.durable()\` requires ${DURABLE_PACKAGE}. Install it and import DurableModule in your app, or pick another transport.`;
export const DURABLE_OUTDATED = `\`transports.durable()\` requires a version of ${DURABLE_PACKAGE} that exports \`${DURABLE_DELIVERY_MODULE}\`. Upgrade it, or pick another transport.`;
export const DURABLE_NOT_CONFIGURED =
  '`transports.durable()` requires durable to be configured: no durable engine resolves in this app. Import DurableModule, or pick another transport.';
export const BULLMQ_NOT_INSTALLED =
  '`transports.queue()` requires bullmq. Install it (`pnpm add bullmq`), or pick another transport.';

const importDurable = (): Promise<DurableDiagnosticsDeliveryModule> =>
  import(/* @vite-ignore */ DURABLE_DELIVERY_MODULE) as Promise<DurableDiagnosticsDeliveryModule>;
const importBullmq = (): Promise<unknown> => import(/* @vite-ignore */ 'bullmq');

const loaders = { durable: importDurable, bullmq: importBullmq };

/** Replace how optional modules are imported. Internal, for tests. */
export function setTransportModuleLoader(
  name: 'durable' | 'bullmq',
  loader: (() => Promise<unknown>) | null,
): void {
  if (name === 'durable') {
    loaders.durable = (loader as typeof importDurable | null) ?? importDurable;
  } else {
    loaders.bullmq = loader ?? importBullmq;
  }
}

/** `'missing'` when `pkg` is not installed, `'outdated'` when it lacks the subpath, else `null`. */
function classifyImportError(error: unknown, pkg: string): 'missing' | 'outdated' | null {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';
  if (!text.includes(pkg)) return null;
  if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return 'outdated';
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return 'missing';
  return null;
}

/**
 * The transport factories for `DiagnosticsModule.forRoot({ default, transports })`:
 *
 * ```ts
 * DiagnosticsModule.forRoot({
 *   default: 'queue',
 *   transports: {
 *     redis: transports.redis({ pub, sub }),
 *     queue: transports.queue({ connection: { host: 'localhost', port: 6379 } }),
 *     durable: transports.durable({ retries: 5 }),
 *   },
 * })
 * ```
 *
 * Each factory returns a lazy {@link TransportProvider}: only the selected `default` starts, and
 * only it imports its optional dependency.
 */
export const transports = {
  /**
   * Broadcast over Redis pub/sub, best-effort: listeners run in every process the event reaches.
   * Events of libs with listeners are forwarded automatically; `libs`/`channels`/`all` forward more.
   */
  redis(config: RedisTransportConfig): TransportProvider {
    return async (ctx) => {
      const libs = [...new Set([...(config.libs ?? []), ...ctx.listenerLibs])];
      const receive = ctx.role !== 'api';
      const stop = createDiagnosticsRedisRelay({
        pub: config.pub,
        ...(receive ? (config.sub !== undefined ? { sub: config.sub } : {}) : { receive: false }),
        libs,
        ...(config.channels !== undefined ? { channels: config.channels } : {}),
        ...(config.all !== undefined ? { all: config.all } : {}),
        ...(config.redisChannel !== undefined ? { redisChannel: config.redisChannel } : {}),
        nodeId: ctx.nodeId,
      });
      return { stop };
    };
  },

  /**
   * Run listeners through BullMQ: one job per `(listener, event)`, retried when the handler throws
   * (at-least-once). Every process that is not `role: 'api'` runs a worker for the queue.
   * Requires the optional peer `bullmq`.
   */
  queue(config: QueueTransportConfig): TransportProvider {
    return async (ctx) => {
      let bullmq: unknown;
      try {
        bullmq = await loaders.bullmq();
      } catch (error) {
        if (classifyImportError(error, 'bullmq') === 'missing') {
          throw new Error(BULLMQ_NOT_INSTALLED, { cause: error });
        }
        throw error;
      }
      const { createQueueTransport } = await import('./queue-transport.js');
      return createQueueTransport(
        bullmq as Parameters<typeof createQueueTransport>[0],
        config,
        ctx,
      );
    };
  },

  /**
   * Run listeners as durable runs: one run per `(listener, event)`, retried with backoff and
   * idempotent per event id. Imports `@dudousxd/nestjs-durable-diagnostics/delivery` only when this
   * transport is the selected `default`; bootstrap fails with a clear error when it is missing or
   * durable is not configured.
   */
  durable(config: DurableTransportConfig = {}): TransportProvider {
    return async (ctx) => {
      let durable: DurableDiagnosticsDeliveryModule;
      try {
        durable = await loaders.durable();
      } catch (error) {
        const kind = classifyImportError(error, DURABLE_PACKAGE);
        if (kind === 'missing') throw new Error(DURABLE_NOT_INSTALLED, { cause: error });
        if (kind === 'outdated') throw new Error(DURABLE_OUTDATED, { cause: error });
        throw error;
      }
      if (
        typeof durable?.isConfigured !== 'function' ||
        typeof durable.createDeliveryTransport !== 'function'
      ) {
        throw new Error(DURABLE_OUTDATED);
      }
      if (!(await durable.isConfigured(ctx.moduleRef))) throw new Error(DURABLE_NOT_CONFIGURED);
      return durable.createDeliveryTransport(
        {
          moduleRef: ctx.moduleRef,
          nodeId: ctx.nodeId,
          role: ctx.role,
          invoke: ctx.invoke,
          listenerIds: ctx.listenerIds,
        },
        config,
      );
    };
  },
};
