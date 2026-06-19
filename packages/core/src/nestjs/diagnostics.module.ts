import { type DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DiagnosticsExplorer } from './diagnostics.explorer.js';

@Module({})
export class DiagnosticsModule {
  /** Register once at the app root; enables `@OnDiagnostic` on any provider. */
  static forRoot(): DynamicModule {
    return {
      module: DiagnosticsModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [DiagnosticsExplorer],
    };
  }
}
