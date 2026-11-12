import { type DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DiagnosticsExplorer } from './diagnostics.explorer.js';
import {
  DIAGNOSTICS_OPTIONS,
  type DiagnosticsModuleAsyncOptions,
  type DiagnosticsModuleOptions,
} from './diagnostics.options.js';
import { DiagnosticsRecentEvents } from './recent-events.service.js';
import type { TransportProvider } from './transports.js';

@Module({})
export class DiagnosticsModule {
  /**
   * Register once at the app root; enables `@OnDiagnostic` on any provider. Pick a `default`
   * transport to run listeners across processes.
   */
  static forRoot<TTransports extends Record<string, TransportProvider>>(
    options: DiagnosticsModuleOptions<TTransports> = {},
  ): DynamicModule {
    return {
      module: DiagnosticsModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        { provide: DIAGNOSTICS_OPTIONS, useValue: options },
        DiagnosticsExplorer,
        DiagnosticsRecentEvents,
      ],
      exports: [DiagnosticsRecentEvents],
    };
  }

  /** Like {@link forRoot}, with options built from injected providers. */
  static forRootAsync(options: DiagnosticsModuleAsyncOptions): DynamicModule {
    return {
      module: DiagnosticsModule,
      global: true,
      imports: [DiscoveryModule, ...(options.imports ?? [])],
      providers: [
        {
          provide: DIAGNOSTICS_OPTIONS,
          useFactory: options.useFactory,
          inject: (options.inject ?? []) as never,
        },
        DiagnosticsExplorer,
        DiagnosticsRecentEvents,
      ],
      exports: [DiagnosticsRecentEvents],
    };
  }
}
