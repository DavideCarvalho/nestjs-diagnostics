export { CHANNEL_PREFIX, channelName, emit, getChannel, SCHEMA_VERSION } from './channel.js';
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
