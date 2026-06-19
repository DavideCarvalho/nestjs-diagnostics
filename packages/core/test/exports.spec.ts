import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import * as nestjsApi from '../src/nestjs/index.js';

describe('public API surface', () => {
  it('exports capability and assertCapabilityNaming from the main barrel (Nest-free)', () => {
    expect(typeof api.capability).toBe('function');
    expect(typeof api.assertCapabilityNaming).toBe('function');
    expect('InjectCapability' in api).toBe(false);
  });

  it('exports InjectCapability from the nestjs subpath barrel', () => {
    expect(typeof nestjsApi.InjectCapability).toBe('function');
  });
});
