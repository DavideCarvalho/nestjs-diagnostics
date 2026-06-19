import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

describe('public API surface', () => {
  it('exports the capability protocol primitives', () => {
    expect(typeof api.capability).toBe('function');
    expect(typeof api.InjectCapability).toBe('function');
    expect(typeof api.assertCapabilityNaming).toBe('function');
  });
});
