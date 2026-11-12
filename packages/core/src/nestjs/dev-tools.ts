import diagnostics_channel from 'node:diagnostics_channel';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { CHANNEL_PREFIX } from '../channel.js';
import { OFFICIAL_CHANNELS } from '../official.js';
import { recentEventsBuffer } from '../recent.js';
import { registeredChannels } from '../registry.js';
import { DiagnosticsExplorer } from './diagnostics.explorer.js';
import { DIAGNOSTICS_OPTIONS, type DiagnosticsModuleOptions } from './diagnostics.options.js';
import type { DiagnosticsRole } from './role.js';
import { transportKind } from './transports.js';

// ── the dev-tools contract (v1), re-declared: this package never imports the agent's MCP server ──

/** The process-wide slot the Aviary dev MCP endpoint serves (`@dudousxd/nestjs-agent-mcp-server`). */
export const DEV_TOOLS_SLOT = Symbol.for('@dudousxd/aviary:dev-tools');

/** One property of a {@link DevToolInputSchema}. */
export interface DevToolInputProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: readonly string[];
  items?: { type: 'string' };
  minimum?: number;
  maximum?: number;
}

/** A dev tool's input: an object of scalar / enum / array-of-string properties. */
export interface DevToolInputSchema {
  type: 'object';
  properties: Record<string, DevToolInputProperty>;
  required?: string[];
}

/** What a tool's `run` receives besides its input. */
export interface DevToolCall {
  context: unknown;
  caller: { id: string; via: 'token' | 'session' | 'open' };
  limits: { maxRows: number; maxBytes: number };
}

/** One developer tool, as the dev-tools slot takes it. */
export interface DiagnosticsDevTool {
  name: string;
  kind: 'read' | 'action';
  description: string;
  input: DevToolInputSchema;
  destructive?: boolean;
  available?(): boolean | Promise<boolean>;
  run(input: Record<string, unknown>, call?: DevToolCall): Promise<unknown>;
}

/**
 * A lib registration. Diagnostics has no console, so it registers WITHOUT `authorize`: the dev
 * endpoint's own `devTools.authorize` gates it.
 */
interface DevToolsLib {
  lib: string;
  title: string;
  authorize?: (context: unknown) => Promise<unknown>;
  tools: DiagnosticsDevTool[];
}

interface DevToolsSlot {
  readonly version: 1;
  readonly libs: DevToolsLib[];
  register(lib: DevToolsLib): () => void;
  /** Optional capability probe of the hub. */
  supports?(capability: string): boolean;
}

/** The slot, created when absent (whoever loads first creates it). */
function devToolsSlot(): Partial<DevToolsSlot> {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[DEV_TOOLS_SLOT] as Partial<DevToolsSlot> | undefined;
  if (existing !== undefined) return existing;
  const libs: DevToolsLib[] = [];
  const slot: DevToolsSlot = {
    version: 1,
    libs,
    register(lib) {
      if (libs.some((entry) => entry.lib === lib.lib)) {
        throw new Error(`dev tools: the lib "${lib.lib}" is already registered`);
      }
      libs.push(lib);
      return () => {
        const index = libs.indexOf(lib);
        if (index !== -1) libs.splice(index, 1);
      };
    },
  };
  holder[DEV_TOOLS_SLOT] = slot;
  return slot;
}

// ── diagnostics' tools ─────────────────────────────────────────────────────────

/** What the tools read about this process, at call time. */
export interface DiagnosticsDevToolsDeps {
  /** The `DiagnosticsModule` options (`default`, `role`, `transports`). */
  options: () => DiagnosticsModuleOptions;
  /** The `@OnDiagnostic` listeners of this process. */
  listeners: () => ReadonlyArray<{
    id: string;
    method: string;
    matchers: ReadonlyArray<{ lib: string; event?: string | RegExp }>;
  }>;
}

const limit: DevToolInputProperty = {
  type: 'integer',
  description: 'How many items to return (default 20, max 100).',
  minimum: 1,
  maximum: 100,
};
const page: DevToolInputProperty = {
  type: 'integer',
  description: 'Page number, from 1 (the `next` of the previous answer).',
  minimum: 1,
};
const lib: DevToolInputProperty = {
  type: 'string',
  description: "Only this library ('durable', 'resilience', 'billing'…).",
};

function intOf(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(max, Math.floor(value)))
    : fallback;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** One page of `items` in the `{ items, next }` shape every dev-tools list returns. */
function pageOf<T>(items: readonly T[], input: Record<string, unknown>) {
  const size = intOf(input.limit, 20, 100);
  const number = intOf(input.page, 1);
  const start = (number - 1) * size;
  return {
    items: items.slice(start, start + size),
    next: start + size < items.length ? number + 1 : null,
  };
}

/** `aviary:durable:run.completed` → `{ lib: 'durable', event: 'run.completed' }`. */
function parseChannel(name: string): { lib: string; event: string } {
  const rest = name.slice(name.indexOf(':') + 1);
  const at = rest.indexOf(':');
  return at === -1
    ? { lib: rest, event: '' }
    : { lib: rest.slice(0, at), event: rest.slice(at + 1) };
}

const SPAN_PHASES = ['start', 'end', 'asyncStart', 'asyncEnd', 'error'] as const;

/**
 * Subscribers of a channel, without the recent-events buffer's own subscription. `null` when the
 * Node version does not expose the count.
 */
function subscriberCount(name: string): number | null {
  const channel = diagnostics_channel.channel(name) as unknown as {
    _subscribers?: unknown[];
    hasSubscribers: boolean;
  };
  // A channel nobody ever subscribed to has no subscriber list at all.
  if (!Array.isArray(channel._subscribers)) return channel.hasSubscribers ? null : 0;
  const own = recentEventsBuffer()?.isSubscribedTo(name) ? 1 : 0;
  return Math.max(0, channel._subscribers.length - own);
}

/** Subscribers across the `trace()` span sub-channels of `base`. */
function spanSubscriberCount(base: string): number | null {
  let total = 0;
  for (const phase of SPAN_PHASES) {
    const count = subscriberCount(`${base}:${phase}`);
    if (count === null) return null;
    total += count;
  }
  return total;
}

interface ChannelRow {
  channel: string;
  lib: string;
  event: string;
  source: 'aviary' | 'nestjs';
  subscribers: number | null;
  spanSubscribers?: number | null;
}

function channelRows(): ChannelRow[] {
  const aviary: ChannelRow[] = registeredChannels()
    .filter((name) => name.startsWith(`${CHANNEL_PREFIX}:`))
    .sort()
    .map((channel) => ({
      channel,
      ...parseChannel(channel),
      source: 'aviary',
      subscribers: subscriberCount(channel),
      spanSubscribers: spanSubscriberCount(channel),
    }));
  const official: ChannelRow[] = Object.values(OFFICIAL_CHANNELS)
    .flatMap((map) => Object.values(map) as string[])
    .sort()
    .map((channel) => ({
      channel,
      ...parseChannel(channel),
      source: 'nestjs',
      subscribers: subscriberCount(channel),
    }));
  return [...aviary, ...official];
}

function describeTransport(options: DiagnosticsModuleOptions): {
  name: string | null;
  kind: string;
  role: DiagnosticsRole;
} {
  const role = options.role ?? 'all';
  if (!options.default) return { name: null, kind: 'local', role };
  const kind = transportKind(options.transports?.[options.default]) ?? 'custom';
  return { name: options.default, kind, role };
}

const RECENT_OFF =
  'The recent-events buffer is off in this process. It runs unless NODE_ENV is production; set `recent: { size: 500 }` in DiagnosticsModule.forRoot() to turn it on anywhere.';

/** The diagnostics developer tools (all read-only): channels, listeners and recent events. */
export function diagnosticsDevTools(deps: DiagnosticsDevToolsDeps): DiagnosticsDevTool[] {
  return [
    {
      name: 'diagnostics_list_channels',
      kind: 'read',
      description:
        'Every aviary:<lib>:<event> diagnostics channel this process has seen and every first-party ' +
        'nestjs:<lib>:<type> channel, with lib, event, source and how many subscribers it has (for ' +
        'aviary channels also for trace() spans; 0 = publishing costs nothing; the recent-events ' +
        'buffer is not counted). Paged: { items, next }.',
      input: {
        type: 'object',
        properties: {
          lib,
          source: {
            type: 'string',
            enum: ['aviary', 'nestjs'],
            description: "'aviary' for Aviary libs' channels, 'nestjs' for first-party ones.",
          },
          subscribed: {
            type: 'boolean',
            description: 'true: only channels someone listens to; false: only silent ones.',
          },
          limit,
          page,
        },
      },
      async run(input) {
        const only = str(input.lib);
        const source = str(input.source);
        const items = channelRows()
          .filter((c) => only === undefined || c.lib === only)
          .filter((c) => source === undefined || c.source === source)
          .filter((c) =>
            typeof input.subscribed === 'boolean'
              ? (c.subscribers ?? 0) + (c.spanSubscribers ?? 0) > 0 === input.subscribed
              : true,
          );
        return pageOf(items, input);
      },
    },
    {
      name: 'diagnostics_list_listeners',
      kind: 'read',
      description:
        'The app @OnDiagnostic listeners of this process: id (<Class>#<method>), lib, event matcher ' +
        "('*' = every event of the lib, /regex/ or exact) and method, plus the transport that runs " +
        "them (local, redis, queue, durable or custom) and this process's role. Paged: { items, next }.",
      input: { type: 'object', properties: { lib, limit, page } },
      async run(input) {
        const only = str(input.lib);
        const items = deps
          .listeners()
          .flatMap((l) =>
            l.matchers.map((m) => ({
              id: l.id,
              lib: m.lib,
              event:
                m.event === undefined ? '*' : m.event instanceof RegExp ? String(m.event) : m.event,
              method: l.method,
            })),
          )
          .filter((l) => only === undefined || l.lib === only);
        return { transport: describeTransport(deps.options()), ...pageOf(items, input) };
      },
    },
    {
      name: 'diagnostics_list_recent_events',
      kind: 'read',
      description:
        'The newest diagnostics events of the process that answers, newest first: emit() events, ' +
        'trace() span phases (phase, spanId, result, error) and first-party nestjs:* events ' +
        "(source: 'nestjs'). Payloads are cut to 2 KB with secret-looking keys redacted. Filter by " +
        'lib, event (exact, or /regex/) and traceId. Paged: { items, next }.',
      input: {
        type: 'object',
        properties: {
          lib,
          event: {
            type: 'string',
            description: "An exact event name, or a /regex/ like '/run\\.(failed|cancelled)/'.",
          },
          traceId: { type: 'string', description: 'Only events of this trace.' },
          limit,
          page,
        },
      },
      async run(input) {
        const buffer = recentEventsBuffer();
        if (buffer === null) {
          return { items: [], next: null, enabled: false, scope: 'this process', hint: RECENT_OFF };
        }
        const libFilter = str(input.lib);
        const event = str(input.event);
        const traceId = str(input.traceId);
        const size = intOf(input.limit, 20, 100);
        const number = intOf(input.page, 1);
        const window = buffer.list({
          ...(libFilter !== undefined ? { lib: libFilter } : {}),
          ...(event !== undefined ? { event } : {}),
          ...(traceId !== undefined ? { traceId } : {}),
          limit: size + 1,
          offset: (number - 1) * size,
        });
        return {
          items: window.slice(0, size),
          next: window.length > size ? number + 1 : null,
          enabled: true,
          scope: 'this process',
          buffered: buffer.count,
          size: buffer.size,
        };
      },
    },
  ];
}

/** Why {@link registerDiagnosticsDevTools} did or did not register. */
export type DevToolsRegistration = 'registered' | 'unsupported' | 'failed';

/**
 * Register the diagnostics tools into the dev-tools slot (created when absent), without an
 * `authorize`: the dev endpoint's `devTools.authorize` gates them. A hub that says it cannot gate a
 * lib without a console (`supports('endpoint-authorize')` is false) is left alone. Never throws.
 */
export function registerDiagnosticsDevTools(deps: DiagnosticsDevToolsDeps): {
  outcome: DevToolsRegistration;
  unregister?: () => void;
} {
  try {
    const slot = devToolsSlot();
    if (slot.version !== 1 || typeof slot.register !== 'function')
      return { outcome: 'unsupported' };
    if (typeof slot.supports === 'function' && !slot.supports('endpoint-authorize')) {
      return { outcome: 'unsupported' };
    }
    const unregister = slot.register({
      lib: 'diagnostics',
      title: 'Diagnostics bus',
      tools: diagnosticsDevTools(deps),
    });
    return { outcome: 'registered', unregister };
  } catch {
    return { outcome: 'failed' };
  }
}

/** Registers the diagnostics dev tools at module init and removes them at module destroy. */
@Injectable()
export class DiagnosticsDevTools implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DiagnosticsDevTools');
  private readonly options: DiagnosticsModuleOptions;
  private unregister: (() => void) | undefined;

  constructor(
    @Inject(DiagnosticsExplorer) private readonly explorer: DiagnosticsExplorer,
    @Optional() @Inject(DIAGNOSTICS_OPTIONS) options?: DiagnosticsModuleOptions,
  ) {
    this.options = options ?? {};
  }

  onModuleInit(): void {
    if (this.options.devTools === false) return;
    const { outcome, unregister } = registerDiagnosticsDevTools({
      options: () => this.options,
      listeners: () => this.explorer.registeredListeners(),
    });
    this.unregister = unregister;
    if (outcome === 'unsupported') {
      this.logger.debug(
        'dev tools not registered: the installed dev-tools hub cannot gate libs without a console (needs devTools.authorize support)',
      );
    } else if (outcome === 'failed') {
      this.logger.debug('dev tools could not be registered');
    }
  }

  onModuleDestroy(): void {
    this.unregister?.();
    this.unregister = undefined;
  }
}
