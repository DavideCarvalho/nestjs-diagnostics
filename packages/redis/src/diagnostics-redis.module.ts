import {
  type DynamicModule,
  Global,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type DiagnosticsRedisRelayOptions, createDiagnosticsRedisRelay } from './relay.js';

export interface DiagnosticsRedisModuleOptions extends DiagnosticsRedisRelayOptions {}

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

/**
 * Import once at the app root to relay diagnostics events across processes over Redis. Supply your
 * `pub` / `sub` ioredis connections (e.g. `redis` and `redis.duplicate()`) and the channel selection.
 * The module manages only the relay's subscriptions — it does NOT open or close your Redis clients.
 *
 * ```ts
 * @Module({ imports: [DiagnosticsRedisModule.forRoot({ pub: redis, sub: redis.duplicate(), libs: ['durable'] })] })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class DiagnosticsRedisModule {
  static forRoot(options: DiagnosticsRedisModuleOptions): DynamicModule {
    return {
      module: DiagnosticsRedisModule,
      providers: [
        { provide: RELAY_OPTIONS, useValue: options },
        {
          provide: DiagnosticsRedisStarter,
          useFactory: (opts: DiagnosticsRedisModuleOptions) => new DiagnosticsRedisStarter(opts),
          inject: [RELAY_OPTIONS],
        },
      ],
    };
  }
}
