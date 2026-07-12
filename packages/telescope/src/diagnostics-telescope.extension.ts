import {
  type DashboardSpec,
  type DataProvider,
  type Entry,
  type ExtensionContext,
  type ExtensionEntryType,
  type StorageProvider,
  TELESCOPE_STORAGE,
  type TelescopeExtension,
  type Watcher,
} from '@dudousxd/nestjs-telescope';
import {
  DIAGNOSTIC_ENTRY_TYPE,
  type DiagnosticEntryContentBase,
  DiagnosticWatcher,
  type DiagnosticWatcherOptions,
} from './diagnostic.watcher.js';

/** Provider names the dashboard panels bind to (namespaced to avoid collisions). */
const TOP_EVENTS_PROVIDER = 'diagnostics.topEvents';
const RECENT_EVENTS_PROVIDER = 'diagnostics.recentEvents';
const COUNT_PROVIDER = 'diagnostics.count';
const BY_LIB_PROVIDER = 'diagnostics.byLib';

/** Options for {@link nestjsDiagnosticsTelescope}. */
export interface DiagnosticsTelescopeOptions {
  /** How many event kinds to surface in the top-N panel. Default 10. */
  topEventsLimit?: number;
  /** How many recent events to list in the table panel. Default 50. */
  recentLimit?: number;
  /**
   * `lib:event` keys to skip recording — the exact label the "Busiest events"
   * panel shows (e.g. `'media:upload.progress'`). Mute high-frequency channels
   * that would otherwise flood the timeline; the events stay live on their
   * diagnostics channel for other subscribers (OTel, custom watchers).
   */
  exclude?: string[];
  /**
   * Record events whose `lib:event` key is claimed by a lib-specific watcher
   * (nestjs-agent's, nestjs-media's own Telescope watcher) via
   * `claimDiagnostics`, instead of skipping them by default. See
   * {@link DiagnosticWatcherOptions.recordClaimed} for the full rationale.
   * `exclude` remains the way to mute noisy events regardless of claim status.
   */
  recordClaimed?: boolean;
}

/**
 * A `@dudousxd/nestjs-telescope` extension that records every diagnostics event
 * any `@dudousxd/nestjs-*` library emits through `@dudousxd/nestjs-diagnostics`
 * — over the `aviary:<lib>:<event>` channels — as one `diagnostic` entry each.
 *
 * It wires four hooks:
 *  - `watchers`     — ONE generic {@link DiagnosticWatcher} that subscribes to
 *    every registered diagnostics channel (current + future).
 *  - `entryTypes`   — registers the navigable `diagnostic` type (sky dot).
 *  - `dashboards`   — a "Diagnostics" page: a top-N of the busiest `lib:event`
 *    pairs and a table of the most recent events.
 *  - `dataProviders`— the server-side queries the two panels bind to.
 *
 * ```ts
 * TelescopeModule.forRoot({ extensions: [nestjsDiagnosticsTelescope()] });
 * ```
 */
export function nestjsDiagnosticsTelescope(
  options: DiagnosticsTelescopeOptions = {},
): TelescopeExtension {
  const topEventsLimit = options.topEventsLimit ?? 10;
  const recentLimit = options.recentLimit ?? 50;

  return {
    // The extension name MUST equal the prefix of the dashboard id and of every
    // data-provider name ('diagnostics.*'). Telescope's controller scopes each
    // panel fetch as `GET /ext/<prefix>/data/<provider>` where `<prefix>` is the
    // dashboard id before the first dot ('diagnostics'), and rejects the request
    // (404 "Unknown data provider") unless `providerOwner(provider) === <prefix>`.
    // A mismatched name ('nestjs-diagnostics') made every panel 404 — the whole
    // Diagnostics dashboard rendered empty.
    name: 'diagnostics',

    watchers(): Watcher[] {
      return [
        new DiagnosticWatcher({
          exclude: options.exclude ?? [],
          recordClaimed: options.recordClaimed ?? false,
        }),
      ];
    },

    entryTypes(): ExtensionEntryType[] {
      return [{ id: DIAGNOSTIC_ENTRY_TYPE, label: 'Diagnostics', dot: 'bg-sky-400' }];
    },

    dashboards(): DashboardSpec[] {
      return [
        {
          id: 'diagnostics.diagnostics',
          label: 'Diagnostics',
          navGroup: 'Observability',
          panels: [
            {
              kind: 'stat',
              title: 'Events captured',
              data: { provider: COUNT_PROVIDER },
              format: 'number',
            },
            {
              kind: 'topN',
              title: 'Busiest events',
              data: { provider: TOP_EVENTS_PROVIDER, query: { limit: topEventsLimit } },
              limit: topEventsLimit,
            },
            {
              kind: 'topN',
              title: 'By library',
              data: { provider: BY_LIB_PROVIDER, query: { limit: topEventsLimit } },
              limit: topEventsLimit,
            },
            {
              kind: 'table',
              title: 'Recent events',
              data: { provider: RECENT_EVENTS_PROVIDER, query: { limit: recentLimit } },
              columns: [
                { key: 'time', label: 'Time' },
                { key: 'lib', label: 'Library' },
                { key: 'event', label: 'Event' },
                { key: 'durationMs', label: 'ms' },
                // Deep-link to the Traces page so a diagnostic event jumps straight
                // to the request/trace it was emitted from. Empty traceId renders as
                // plain text via the {traceId} template collapsing to the list route.
                { key: 'traceId', label: 'Trace', link: { href: '#/traces/{traceId}' } },
              ],
            },
          ],
        },
      ];
    },

    dataProviders(): DataProvider[] {
      return [
        {
          name: COUNT_PROVIDER,
          async resolve(_query, ctx) {
            const entries = await loadDiagnostics(ctx, 5_000);
            return { value: entries.length };
          },
        },
        {
          name: BY_LIB_PROVIDER,
          async resolve(query, ctx) {
            const limit = numberOr(query?.limit, topEventsLimit);
            const entries = await loadDiagnostics(ctx, 5_000);
            const counts = new Map<string, number>();
            for (const entry of entries) {
              const content = entry.content as DiagnosticEntryContentBase | null;
              if (!content) continue;
              counts.set(content.lib, (counts.get(content.lib) ?? 0) + 1);
            }
            const items = [...counts.entries()]
              .map(([label, value]) => ({ label, value }))
              .sort((a, b) => b.value - a.value)
              .slice(0, limit);
            return { items };
          },
        },
        {
          name: TOP_EVENTS_PROVIDER,
          async resolve(query, ctx) {
            const limit = numberOr(query?.limit, topEventsLimit);
            const entries = await loadDiagnostics(ctx);
            const counts = new Map<string, number>();
            for (const entry of entries) {
              const content = entry.content as DiagnosticEntryContentBase | null;
              if (!content) continue;
              const label = `${content.lib}:${content.event}`;
              counts.set(label, (counts.get(label) ?? 0) + 1);
            }
            const items = [...counts.entries()]
              .map(([label, value]) => ({ label, value }))
              .sort((a, b) => b.value - a.value)
              .slice(0, limit);
            return { items };
          },
        },
        {
          name: RECENT_EVENTS_PROVIDER,
          async resolve(query, ctx) {
            const limit = numberOr(query?.limit, recentLimit);
            const entries = await loadDiagnostics(ctx, limit);
            const rows = entries.map((entry) => {
              const content = entry.content as DiagnosticEntryContentBase | null;
              return {
                time: formatTime(content?.ts),
                lib: content?.lib ?? null,
                event: content?.event ?? null,
                durationMs: entry.durationMs ?? null,
                traceId: content?.traceId ?? null,
              };
            });
            return { rows };
          },
        },
      ];
    },
  };
}

/** Resolve the Telescope store and fetch `diagnostic` entries. */
async function loadDiagnostics(ctx: ExtensionContext, limit = 200): Promise<Entry[]> {
  const storage = ctx.moduleRef.get<StorageProvider>(TELESCOPE_STORAGE, { strict: false });
  const page = await storage.get({ type: DIAGNOSTIC_ENTRY_TYPE, limit });
  return page.data;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Format a producer epoch-ms timestamp as a compact UTC `HH:mm:ss`, or '' when absent. */
function formatTime(ts: number | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  return new Date(ts).toISOString().slice(11, 19);
}

export default nestjsDiagnosticsTelescope;
