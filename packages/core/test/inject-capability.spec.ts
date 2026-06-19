import { OPTIONAL_DEPS_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { capability } from '../src/capability.js';
import { InjectCapability } from '../src/inject-capability.js';

describe('InjectCapability', () => {
  it('binds the canonical token at the decorated parameter index', () => {
    class Consumer {
      constructor(@InjectCapability('context', 'accessor') readonly ctx?: unknown) {}
    }
    const injected = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, Consumer) ?? [];
    expect(injected).toContainEqual({ index: 0, param: capability('context', 'accessor') });
  });

  it('marks the parameter @Optional() (absent peer => undefined, never throws)', () => {
    class Consumer {
      constructor(@InjectCapability('context', 'accessor') readonly ctx?: unknown) {}
    }
    const optional = Reflect.getMetadata(OPTIONAL_DEPS_METADATA, Consumer) ?? [];
    expect(optional).toContain(0);
  });
});
