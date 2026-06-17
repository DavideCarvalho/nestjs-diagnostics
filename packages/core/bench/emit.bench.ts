/**
 * Hot-path microbenchmark for the diagnostics `emit`/`getChannel` convention.
 *
 * `emit()` sits on the hot path of every authz decision and inertia render, so
 * the no-subscriber path MUST be effectively free. This bench measures ns/op for
 * the four cases that matter, using `process.hrtime.bigint()` with warmup.
 *
 * Run against the built output (Node strips no types here; we import the compiled
 * `dist/` so there is zero transform overhead in the measurement):
 *
 *   pnpm --filter @dudousxd/nestjs-diagnostics build
 *   node packages/core/bench/emit.bench.ts
 *
 * (The `.ts` extension is fine: Node >=22 strips the types; the imports below
 * resolve to compiled `.js` in `dist/`.)
 */
import diagnostics_channel from 'node:diagnostics_channel';
import { channelName, emit, getChannel } from '../dist/index.js';

const ITERATIONS = 5_000_000;
const WARMUP = 500_000;

const payload = { subject: 'user_123', action: 'read', resource: 'doc_42', allow: true };

/** Measure ns/op for `fn`, run `iters` times after `warmup` warmup iterations. */
function measure(name: string, fn: (i: number) => void, iters = ITERATIONS, warmup = WARMUP): void {
  for (let i = 0; i < warmup; i++) fn(i);
  // Discourage DCE of the loop body.
  let sink = 0;
  const start = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) {
    fn(i);
    sink ^= i;
  }
  const end = process.hrtime.bigint();
  if (sink === -1) console.log('');
  const nsPerOp = Number(end - start) / iters;
  const opsPerSec = 1e9 / nsPerOp;
  console.log(
    `${name.padEnd(58)} ${nsPerOp.toFixed(2).padStart(9)} ns/op   ${Math.round(opsPerSec).toLocaleString().padStart(16)} ops/s`,
  );
}

// (d) Baselines for reference -------------------------------------------------
function emptyFn(_i: number): void {}
measure('(d0) empty function call (baseline)', emptyFn);

const rawName = channelName('authz', 'decision');
const rawChannel = diagnostics_channel.channel(rawName);
measure('(d1) raw channel.hasSubscribers read (no subscriber)', () => {
  if (rawChannel.hasSubscribers) emit('authz', 'decision', payload);
});

// (a) emit() with NO subscriber — the critical common case --------------------
measure('(a) emit(authz,decision) NO subscriber', () => {
  emit('authz', 'decision', payload);
});

// (c) lib-style gated path: cache the channel once, gate on hasSubscribers -----
const gatedChannel = getChannel('authz', 'decision');
measure('(c) gated: if(ch.hasSubscribers) emit() NO subscriber', () => {
  if (gatedChannel.hasSubscribers) emit('authz', 'decision', payload);
});

// (b) emit() WITH one subscriber attached -------------------------------------
const subChannel = diagnostics_channel.channel(channelName('authz', 'decision'));
const onMessage = (msg: unknown) => {
  // Touch the message so the subscriber is not optimized away.
  if ((msg as { ts?: number }).ts === -1) console.log('');
};
subChannel.subscribe(onMessage);
measure('(b) emit(authz,decision) WITH 1 subscriber', () => {
  emit('authz', 'decision', payload);
});
subChannel.unsubscribe(onMessage);

console.log(
  `\n(iterations=${ITERATIONS.toLocaleString()}, warmup=${WARMUP.toLocaleString()}, node=${process.version})`,
);
