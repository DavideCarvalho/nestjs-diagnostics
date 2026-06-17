import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emit, getChannel } from '../src/channel.js';
import {
  onChannelRegistered,
  registerChannel,
  registeredChannels,
  resetRegistry,
} from '../src/registry.js';

describe('channel registry', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('tracks channels touched through getChannel and emit', () => {
    expect(registeredChannels()).toEqual([]);

    getChannel('billing', 'invoice-paid');
    emit('audit', 'login', {}); // no subscriber, but the channel is still registered

    expect(registeredChannels()).toEqual(['aviary:billing:invoice-paid', 'aviary:audit:login']);
  });

  it('is idempotent — re-registering a name does not duplicate it', () => {
    registerChannel('aviary:billing:x');
    registerChannel('aviary:billing:x');
    expect(registeredChannels()).toEqual(['aviary:billing:x']);
  });

  it('fires onChannelRegistered for channels registered after subscribing', () => {
    const seen = vi.fn();
    const off = onChannelRegistered(seen);

    registerChannel('aviary:billing:a');
    registerChannel('aviary:billing:a'); // duplicate → no second fire
    registerChannel('aviary:billing:b');

    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenNthCalledWith(1, 'aviary:billing:a');
    expect(seen).toHaveBeenNthCalledWith(2, 'aviary:billing:b');

    off();
    registerChannel('aviary:billing:c');
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('current + future pattern covers every channel', () => {
    registerChannel('aviary:billing:existing');
    const subscribed: string[] = [];
    const subscribe = (name: string) => subscribed.push(name);

    for (const name of registeredChannels()) subscribe(name);
    const off = onChannelRegistered(subscribe);
    registerChannel('aviary:billing:future');
    off();

    expect(subscribed).toEqual(['aviary:billing:existing', 'aviary:billing:future']);
  });

  it('shares state through a globalThis singleton, so a second module copy sees the same registry', () => {
    // A divergent (un-dedupable) copy of this package would run its own module
    // body, but it resolves the SAME `Symbol.for` slot on globalThis. Simulate
    // that copy by reading the slot directly: a channel registered through the
    // public API must be visible there, and a name injected there must surface
    // through the public API.
    const REGISTRY_KEY = Symbol.for('@dudousxd/nestjs-diagnostics:registry');
    const slot = (globalThis as Record<symbol, { channels: Set<string> } | undefined>)[
      REGISTRY_KEY
    ];
    expect(slot).toBeDefined();

    registerChannel('aviary:copyA:event');
    expect(slot?.channels.has('aviary:copyA:event')).toBe(true);

    slot?.channels.add('aviary:copyB:event');
    expect(registeredChannels()).toContain('aviary:copyB:event');
  });
});
