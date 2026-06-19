# @dudousxd/nestjs-diagnostics-redis

Cross-process transport for [`@dudousxd/nestjs-diagnostics`](https://github.com/DavideCarvalho/nestjs-diagnostics).
A consumer-side **relay** forwards selected local `aviary:<lib>:<event>` channels onto Redis pub/sub
and re-emits Redis-received events back onto the local diagnostics bus — so `@OnDiagnostic` handlers
and `getChannel(...).subscribe(...)` reactions fire **across processes/pods**. The diagnostics core
stays in-process and untouched; this is entirely opt-in.

## Install

```bash
pnpm add @dudousxd/nestjs-diagnostics-redis @dudousxd/nestjs-diagnostics ioredis
```

## Use (Nest)

Supply your own ioredis connections — a publisher and a **separate** subscriber (`redis.duplicate()`,
since a subscribed connection can't publish):

```ts
import Redis from 'ioredis';
import { DiagnosticsRedisModule } from '@dudousxd/nestjs-diagnostics-redis';

const redis = new Redis(process.env.REDIS_URL);

@Module({
  imports: [
    DiagnosticsRedisModule.forRoot({
      pub: redis,
      sub: redis.duplicate(),
      libs: ['durable', 'notifications'], // forward all events of these libs
    }),
  ],
})
export class AppModule {}
```

Now an `@OnDiagnostic('durable', 'run.failed')` handler in **another** process fires when a worker
elsewhere emits it.

## Use (manual)

```ts
import { createDiagnosticsRedisRelay } from '@dudousxd/nestjs-diagnostics-redis';

const teardown = createDiagnosticsRedisRelay({
  pub: redis,
  sub: redis.duplicate(),
  channels: [{ lib: 'resilience', event: 'circuit-opened' }], // exact channels
  // or: libs: ['durable'] | all: true
});
// ... later
teardown();
```

## How it works

- **Forwarder:** subscribes to the selected local channels; each event is published to Redis as
  `{ node, env }` (the diagnostics envelope).
- **Receiver:** subscribes to the Redis channel; each message from a *different* node is re-emitted
  locally via the diagnostics bus, so all local subscribers fire.
- **Loop-safe:** the receiver skips its own echoes (`node === nodeId`) and a re-emit guard stops a
  received event from being forwarded back — so two processes never ping-pong.

## Notes

- **Payloads cross a process boundary as JSON** — class instances arrive as plain objects (no
  methods/prototype), `Date` as an ISO string. Read fields, not behavior, in cross-process handlers.
- **Fire-and-forget**, like the in-process bus: no guaranteed delivery, ordering, or replay.
- The relay never opens or closes your Redis connections — you own their lifecycle. It never throws
  back into `emit()`.
