export { capability } from './capability.js';
export type { CapabilityOf, CapabilityRegistry } from './capability.js';
export { CHANNEL_PREFIX, channelName, emit, getChannel, SCHEMA_VERSION } from './channel.js';
export { claimDiagnostics, isDiagnosticClaimed } from './claims.js';
export { assertCapabilityNaming } from './conformance.js';
export {
  CONTEXT_ACCESSOR,
  type ContextAccessor,
  type ContextStore,
  getContextAccessor,
  resolveTraceId,
  setContextAccessor,
  type UserRef,
} from './context-accessor.js';
export {
  NESTJS_AUTHENTICATION_CHANNELS,
  NESTJS_AUTHORIZATION_CHANNELS,
  NESTJS_MAIL_CHANNELS,
  NESTJS_RESILIENCE_CHANNELS,
  NESTJS_WORKFLOWS_CHANNELS,
  OFFICIAL_CHANNEL_PREFIX,
  OFFICIAL_CHANNELS,
  OFFICIAL_PACKAGE_VERSIONS,
  type OfficialChannelName,
  type OfficialDiagnosticEvent,
  type OfficialLib,
  type OfficialListener,
  type OfficialType,
  officialChannelNames,
  subscribeOfficial,
} from './official.js';
export {
  type ChannelRef,
  createDiagnosticsRedisRelay,
  type DiagnosticsRedisRelayOptions,
  type RedisLike,
  type RedisPipelineLike,
} from './redis-relay.js';
export {
  boundPayload,
  DEFAULT_RECENT_SIZE,
  RECENT_PAYLOAD_BYTES,
  type RecentEvent,
  RecentEventsBuffer,
  type RecentEventsFilter,
  recentEvents,
  recentEventsBuffer,
  startRecentEvents,
  stopRecentEvents,
} from './recent.js';
export { isRelayed, publishRelayed } from './relayed.js';
export {
  onChannelRegistered,
  registerChannel,
  registeredChannels,
  resetRegistry,
} from './registry.js';
export {
  SPAN_SCHEMA_VERSION,
  trace,
  type TraceChannelNames,
  traceChannelNames,
  type TracingChannel,
  tracingChannel,
} from './trace.js';
export type {
  ChannelRegistry,
  DiagnosticEvent,
  EmitOptions,
  EventOf,
  LibOf,
  PayloadOf,
  SpanEvent,
  SpanPhase,
  TraceOptions,
} from './types.js';
