import { describe, expect, it } from 'vitest';
import {
  ON_DIAGNOSTIC_META,
  OnDiagnostic,
  type OnDiagnosticMeta,
} from '../src/nestjs/on-diagnostic.decorator.js';

function metaOf(ctor: object, method: string): OnDiagnosticMeta[] {
  return Reflect.getMetadata(ON_DIAGNOSTIC_META, ctor, method) as OnDiagnosticMeta[];
}

describe('OnDiagnostic', () => {
  it('records an exact (lib, event) subscription', () => {
    class C {
      @OnDiagnostic('resilience', 'circuit-opened')
      h() {}
    }
    expect(metaOf(C.prototype, 'h')).toEqual([{ lib: 'resilience', event: 'circuit-opened' }]);
  });

  it('records a lib wildcard (no event key)', () => {
    class C {
      @OnDiagnostic('resilience')
      h() {}
    }
    expect(metaOf(C.prototype, 'h')).toEqual([{ lib: 'resilience' }]);
  });

  it('accumulates stacked decorators (order-independent)', () => {
    class C {
      @OnDiagnostic('resilience', 'failover')
      @OnDiagnostic('authz', 'decision')
      h() {}
    }
    const metas = metaOf(C.prototype, 'h');
    expect(metas).toHaveLength(2);
    expect(metas).toContainEqual({ lib: 'resilience', event: 'failover' });
    expect(metas).toContainEqual({ lib: 'authz', event: 'decision' });
  });
});
