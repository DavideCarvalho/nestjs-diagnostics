import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  DEFAULT_RECENT_SIZE,
  type RecentEvent,
  type RecentEventsBuffer,
  type RecentEventsFilter,
  recentEventsBuffer,
  startRecentEvents,
  stopRecentEvents,
} from '../recent.js';
import { DIAGNOSTICS_OPTIONS, type DiagnosticsModuleOptions } from './diagnostics.options.js';

/**
 * The buffer size `recent` asks for, or `null` when the buffer stays off: `false` → off; `true` or
 * `{ size }` → on; omitted → on unless `NODE_ENV` is `'production'`.
 */
export function resolveRecentSize(recent: DiagnosticsModuleOptions['recent']): number | null {
  if (recent === false) return null;
  if (recent === true) return DEFAULT_RECENT_SIZE;
  if (typeof recent === 'object' && recent !== null) return recent.size ?? DEFAULT_RECENT_SIZE;
  return process.env.NODE_ENV === 'production' ? null : DEFAULT_RECENT_SIZE;
}

/**
 * The recent-events buffer of this process, as a provider: starts it at module init when `recent`
 * says so, stops it at shutdown, and reads it.
 *
 * ```ts
 * constructor(private readonly recent: DiagnosticsRecentEvents) {}
 * this.recent.list({ lib: 'durable', limit: 50 });
 * ```
 */
@Injectable()
export class DiagnosticsRecentEvents implements OnModuleInit, OnApplicationShutdown {
  private readonly size: number | null;
  private owned: RecentEventsBuffer | null = null;

  constructor(@Optional() @Inject(DIAGNOSTICS_OPTIONS) options?: DiagnosticsModuleOptions) {
    // Validated here, so a bad size fails the boot instead of the first read.
    this.size = resolveRecentSize(options?.recent);
  }

  onModuleInit(): void {
    if (this.size !== null) this.owned = startRecentEvents(this.size);
  }

  onApplicationShutdown(): void {
    if (this.owned !== null && recentEventsBuffer() === this.owned) stopRecentEvents();
    this.owned = null;
  }

  /** Whether the buffer runs in this process. */
  get enabled(): boolean {
    return recentEventsBuffer() !== null;
  }

  /** The newest buffered events matching `filter`, newest first. `[]` when the buffer is off. */
  list(filter?: RecentEventsFilter): RecentEvent[] {
    return recentEventsBuffer()?.list(filter) ?? [];
  }

  /** Drop every buffered event. */
  clear(): void {
    recentEventsBuffer()?.clear();
  }
}
