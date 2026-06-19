import diagnostics_channel from 'node:diagnostics_channel';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CHANNEL_PREFIX, channelName } from '../channel.js';
import { onChannelRegistered, registeredChannels } from '../registry.js';
import type { DiagnosticEvent } from '../types.js';
import { ON_DIAGNOSTIC_META, type OnDiagnosticMeta } from './on-diagnostic.decorator.js';

type Invoke = (event: DiagnosticEvent) => void;

@Injectable()
export class DiagnosticsExplorer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DiagnosticsExplorer');
  private readonly subscriptions: Array<{ name: string; listener: (msg: unknown) => void }> = [];
  private readonly wildcards: Array<{ prefix: string; invoke: Invoke }> = [];
  private offChannelRegistered: (() => void) | null = null;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const metas = Reflect.getMetadata(ON_DIAGNOSTIC_META, proto, methodName) as
          | OnDiagnosticMeta[]
          | undefined;
        if (!metas?.length) continue;
        for (const meta of metas) {
          const invoke: Invoke = (event) => this.safeInvoke(instance, methodName, event);
          if (meta.event !== undefined) {
            this.subscribe(channelName(meta.lib, meta.event), invoke);
          } else {
            const prefix = `${CHANNEL_PREFIX}:${meta.lib}:`;
            this.wildcards.push({ prefix, invoke });
            for (const name of registeredChannels()) {
              if (name.startsWith(prefix)) this.subscribe(name, invoke);
            }
          }
        }
      }
    }
    this.offChannelRegistered = onChannelRegistered((name) => {
      for (const w of this.wildcards) {
        if (name.startsWith(w.prefix)) this.subscribe(name, w.invoke);
      }
    });
  }

  onApplicationShutdown(): void {
    this.offChannelRegistered?.();
    this.offChannelRegistered = null;
    for (const { name, listener } of this.subscriptions) {
      diagnostics_channel.channel(name).unsubscribe(listener);
    }
    this.subscriptions.length = 0;
    this.wildcards.length = 0;
  }

  /** Subscribe once to `name`; the listener fans the envelope into `invoke`. */
  private subscribe(name: string, invoke: Invoke): void {
    const listener = (msg: unknown) => invoke(msg as DiagnosticEvent);
    diagnostics_channel.channel(name).subscribe(listener);
    this.subscriptions.push({ name, listener });
  }

  /** Invoke a handler, swallowing sync throws and async rejections so a buggy
   *  reaction can never break the synchronous `emit()` that triggered it. */
  private safeInvoke(
    instance: Record<string, unknown>,
    methodName: string,
    event: DiagnosticEvent,
  ): void {
    try {
      const fn = instance[methodName] as (e: DiagnosticEvent) => unknown;
      const result = fn.call(instance, event);
      if (result != null && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch((err) => this.logError(methodName, err));
      }
    } catch (err) {
      this.logError(methodName, err);
    }
  }

  private logError(methodName: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`@OnDiagnostic ${methodName} handler failed: ${message}`);
  }
}
