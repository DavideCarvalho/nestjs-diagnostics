/**
 * One "process" of two-process.spec.ts. Boots a Nest application context from the BUILT package
 * (`dist/`) with `DiagnosticsModule.forRoot({ role, default: mode })` against a real Redis, then
 * talks to the spec over stdio:
 *
 *   stdout: one JSON object per line ({ ready }, { invoked }, { bootError })
 *   stdin:  `emit <json payload>` emits `aviary:agent:run.finished`; `stop` shuts down
 *
 * argv: <mode: redis | queue | durable> <role: all | api | worker> <name> <redisUrl> <namespace>
 */
import 'reflect-metadata';
import { createInterface } from 'node:readline';

const [mode, role, name, redisUrl, namespace] = process.argv.slice(2);
const dist = new URL('../../../dist/', import.meta.url);
const { emit } = await import(new URL('index.js', dist).href);
const { DiagnosticsModule, OnDiagnostic, transports } = await import(
  new URL('nestjs/index.js', dist).href
);
const { Injectable, Module } = await import('@nestjs/common');
const { NestFactory } = await import('@nestjs/core');
const { Redis } = await import('ioredis');

const out = (message) => process.stdout.write(`${JSON.stringify({ name, ...message })}\n`);

const redis =
  redisUrl && mode !== 'durable' ? new Redis(redisUrl, { maxRetriesPerRequest: null }) : null;

// The listener every process registers. In queue mode the FIRST attempt across all processes
// fails (a Redis SET NX decides which one), so the spec sees the retry.
class TrackRun {
  async handle(event) {
    let fail = false;
    if (mode === 'queue') fail = (await redis.set(`${namespace}:failed`, '1', 'NX')) === 'OK';
    out({ invoked: { id: event.id, payload: event.payload, failed: fail } });
    if (fail) throw new Error('first attempt fails');
  }
}
OnDiagnostic('agent', 'run.finished')(
  TrackRun.prototype,
  'handle',
  Object.getOwnPropertyDescriptor(TrackRun.prototype, 'handle'),
);
Injectable()(TrackRun);

const sub = redis && role !== 'api' ? redis.duplicate() : undefined;
const url = redisUrl ? new URL(redisUrl) : null;
const options = {
  role,
  default: mode,
  nodeId: name,
  transports: {
    ...(redis
      ? {
          redis: transports.redis({ pub: redis, sub, redisChannel: `${namespace}:relay` }),
          queue: transports.queue({
            connection: { host: url.hostname, port: Number(url.port || 6379) },
            queue: namespace,
            retries: 3,
            backoff: { type: 'fixed', delay: 50 },
          }),
        }
      : {}),
    durable: transports.durable(),
  },
};

class AppModule {}
Module({ imports: [DiagnosticsModule.forRoot(options)], providers: [TrackRun] })(AppModule);

let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
} catch (error) {
  out({ bootError: error instanceof Error ? error.message : String(error) });
  redis?.disconnect();
  process.exit(0);
}
// The relay subscribes without waiting for the ack; make sure it is live before reporting ready.
if (sub) await sub.subscribe(`${namespace}:relay`);
out({ ready: true });

const stop = async () => {
  await app.close();
  sub?.disconnect();
  await redis?.quit();
  process.exit(0);
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const [command, ...rest] = line.split(' ');
  if (command === 'emit') emit('agent', 'run.finished', JSON.parse(rest.join(' ')));
  if (command === 'stop') void stop();
});
