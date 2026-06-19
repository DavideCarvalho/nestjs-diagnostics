import { describe, expect, it } from 'vitest';
import { capability } from '../src/capability.js';

describe('capability', () => {
  it('builds the canonical @dudousxd/nestjs-<lib>:<name> Symbol.for token', () => {
    const token = capability('context', 'accessor');
    expect(token).toBe(Symbol.for('@dudousxd/nestjs-context:accessor'));
    expect(token.description).toBe('@dudousxd/nestjs-context:accessor');
  });

  it('returns the SAME symbol across calls (global registry)', () => {
    expect(capability('authz', 'role-provider')).toBe(capability('authz', 'role-provider'));
  });

  it('matches a token currently hand-rolled in another lib (non-breaking)', () => {
    // nestjs-authz/durable today declare this by hand; the factory must resolve identical.
    expect(capability('context', 'accessor')).toBe(
      Symbol.for('@dudousxd/nestjs-context:accessor'),
    );
  });
});
