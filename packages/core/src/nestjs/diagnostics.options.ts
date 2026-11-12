import type { DynamicModule } from '@nestjs/common';
import type { DiagnosticsRole } from './role.js';
import type { TransportProvider } from './transports.js';

/** Injection token of the {@link DiagnosticsModuleOptions}. */
export const DIAGNOSTICS_OPTIONS = Symbol.for('@dudousxd/nestjs-diagnostics:options');

/**
 * Options of `DiagnosticsModule.forRoot()`. Without a `default` transport, listeners run in the
 * emitting process (local).
 */
export interface DiagnosticsModuleOptions<
  TTransports extends Record<string, TransportProvider> = Record<string, TransportProvider>,
> {
  /**
   * Which half of a split deployment this process is: `'all'` (default), `'api'` (emits and hands
   * work to the transport, never consumes or runs listeners) or `'worker'` (consumes and runs
   * listeners). `'api'` and `'worker'` need a `default` transport.
   */
  role?: DiagnosticsRole;
  /** Name of the transport (a key of `transports`) that starts at bootstrap. */
  default?: keyof TTransports & string;
  /** Named transports, built with the `transports` factory. Only `default` starts. */
  transports?: TTransports;
  /** Unique id of THIS process, for echo suppression. Default a random id. */
  nodeId?: string;
}

/** Async configuration: build the options (and your Redis clients) from DI. */
export interface DiagnosticsModuleAsyncOptions {
  /** Modules whose exported providers the factory injects. */
  imports?: DynamicModule['imports'];
  inject?: unknown[];
  useFactory: (...args: never[]) => Promise<DiagnosticsModuleOptions> | DiagnosticsModuleOptions;
}
