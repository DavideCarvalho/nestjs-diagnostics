import { describe, expect, it } from 'vitest';
import { capability } from '../src/capability.js';
import { assertCapabilityNaming } from '../src/conformance.js';

describe('assertCapabilityNaming', () => {
  it('passes when every token goes through the factory', () => {
    const tokens = {
      ACCESSOR: capability('context', 'accessor'),
      OPTIONS: capability('context', 'options'),
    };
    expect(() => assertCapabilityNaming('context', tokens)).not.toThrow();
  });

  it('throws naming the offending export when a token is off-pattern', () => {
    const tokens = {
      STATE_STORE: Symbol.for('nestjs-durable:STATE_STORE'), // legacy drift
    };
    expect(() => assertCapabilityNaming('durable', tokens)).toThrowError(/STATE_STORE/);
  });

  it('throws when a token belongs to a different lib prefix', () => {
    const tokens = { WRONG: capability('context', 'accessor') };
    expect(() => assertCapabilityNaming('authz', tokens)).toThrowError(/@dudousxd\/nestjs-authz:/);
  });

  it('throws and names the offending export when a token has no description (undefined)', () => {
    // Symbol('accessor') has a description string 'accessor', NOT undefined.
    // To get desc === undefined we need Symbol() with no argument.
    const tokens = { BAD: Symbol() };
    const fn = () => assertCapabilityNaming('context', tokens);
    expect(fn).toThrow();
    const err = (() => { try { fn(); } catch (e) { return e as Error; } })()!;
    expect(err.message).toMatch(/BAD/);
    // JSON.stringify(undefined) stringifies to undefined in template literals → the word "undefined"
    expect(err.message).toContain('undefined');
  });
});
