import {
  type DynamicModule,
  Global,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { type DiagnosticsRedisRelayOptions, createDiagnosticsRedisRelay } from './relay.js';

export interface DiagnosticsRedisModuleOptions extends DiagnosticsRedisRelayOptions {}

/** Async configuration — build the relay options (incl. your ioredis clients) from DI. */
export interface DiagnosticsRedisModuleAsyncOptions {
  /** Modules to import so the factory can inject their exported providers (e.g. your Redis module). */
  imports?: DynamicModule['imports'];
  inject?: unknown[];
  useFactory: (
    ...args: never[]
  ) => Promise<DiagnosticsRedisModuleOptions> | DiagnosticsRedisModuleOptions;
}

const RELAY_OPTIONS = Symbol('diagnostics-redis:options');

@Injectable()
class DiagnosticsRedisStarter implements OnApplicationBootstrap, OnApplicationShutdown {
  private teardown: (() => void) | null = null;

  constructor(private readonly options: DiagnosticsRedisModuleOptions) {}

  onApplicationBootstrap(): void {
    this.teardown = createDiagnosticsRedisRelay(this.options);
  }

  onApplicationShutdown(): void {
    this.teardown?.();
    this.teardown = null;
  }
}

/** Starts the relay from whatever is bound to RELAY_OPTIONS — shared by forRoot and forRootAsync. */
const starterProvider: Provider = {
  provide: DiagnosticsRedisStarter,
  useFactory: (opts: DiagnosticsRedisModuleOptions) => new DiagnosticsRedisStarter(opts),
  inject: [RELAY_OPTIONS],
};

/**
 * Import once at the app root to relay diagnostics events across processes over Redis. Supply your
 * `pub` / `sub` ioredis connections (e.g. `redis` and `redis.duplicate()`) and the channel selection.
 * The module manages only the relay's subscriptions — it does NOT open or close your Redis clients.
 *
 * ```ts
 * @Module({
 *   imports: [
 *     DiagnosticsRedisModule.forRootAsync({
 *       inject: [REDIS],
 *       useFactory: (redis: Redis) => ({ pub: redis, sub: redis.duplicate(), libs: ['durable'] }),
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class DiagnosticsRedisModule {
  /** Static configuration — pass already-built `pub` / `sub` clients and the channel selection. */
  static forRoot(options: DiagnosticsRedisModuleOptions): DynamicModule {
    return {
      module: DiagnosticsRedisModule,
      providers: [{ provide: RELAY_OPTIONS, useValue: options }, starterProvider],
    };
  }

  /** Async configuration — build the options (incl. your ioredis clients) from injected dependencies. */
  static forRootAsync(options: DiagnosticsRedisModuleAsyncOptions): DynamicModule {
    return {
      module: DiagnosticsRedisModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: RELAY_OPTIONS,
          useFactory: options.useFactory,
          inject: (options.inject ?? []) as never,
        },
        starterProvider,
      ],
    };
  }
}
