// Type-level spec for @OnDiagnostic. Compiled by listener-types.spec.ts: it must compile with no
// errors, so every `@ts-expect-error` below has to be a real error.
import type { DiagnosticEvent } from '../../../src/index.js';
import { type DiagnosticEventOf, OnDiagnostic } from '../../../src/nestjs/index.js';

declare module '../../../src/types.js' {
  interface ChannelRegistry {
    agent: {
      'run.finished': { runId: string; tokens: number };
    };
  }
}

export class TrackRun {
  @OnDiagnostic('agent', 'run.finished')
  typed(event: DiagnosticEventOf<'agent', 'run.finished'>) {
    const tokens: number = event.payload.tokens;
    return tokens;
  }

  @OnDiagnostic('agent', 'run.finished')
  inferred(event: DiagnosticEvent<{ runId: string; tokens: number }>) {
    return event.payload.runId;
  }

  // @ts-expect-error the payload of agent:run.finished has no `missing` string field
  @OnDiagnostic('agent', 'run.finished')
  wrong(event: DiagnosticEvent<{ missing: string }>) {
    return event;
  }

  @OnDiagnostic('agent')
  wildcard(event: DiagnosticEvent) {
    return event.payload;
  }

  @OnDiagnostic('agent', /^step\./)
  pattern(event: DiagnosticEvent<unknown>) {
    return event;
  }

  // An unregistered channel keeps the untyped path: any annotation is accepted.
  @OnDiagnostic('billing', 'invoice-paid')
  untyped(event: DiagnosticEvent) {
    return event.payload;
  }

  @OnDiagnostic('billing', 'invoice-paid')
  ownType(event: DiagnosticEvent<{ amount: number }>) {
    return event.payload.amount;
  }

  @OnDiagnostic('billing')
  ownTypeWildcard(event: DiagnosticEvent<{ amount: number }>) {
    return event.payload.amount;
  }
}
