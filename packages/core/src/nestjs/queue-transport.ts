import type { DeliveredEvent, ListenerDelivery } from './delivery.js';
import type { QueueTransportConfig, TransportContext, TransportHandle } from './transports.js';

/** Data of one listener job. */
export interface DiagnosticsListenerJobData {
  listenerId: string;
  envelope: DeliveredEvent;
}

interface JobOptionsLike {
  jobId: string;
  attempts: number;
  backoff: { type: 'fixed' | 'exponential'; delay: number };
  removeOnComplete: boolean | number;
  removeOnFail: boolean | number;
}

interface QueueLike {
  addBulk(
    jobs: Array<{ name: string; data: DiagnosticsListenerJobData; opts: JobOptionsLike }>,
  ): Promise<unknown>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  close(): Promise<void>;
}

interface WorkerLike {
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(
    event: 'failed',
    listener: (job: { data: DiagnosticsListenerJobData } | undefined, error: Error) => void,
  ): unknown;
  close(): Promise<void>;
}

/** The slice of the `bullmq` module this transport uses. */
export interface BullmqModuleLike {
  Queue: new (name: string, opts: Record<string, unknown>) => QueueLike;
  Worker: new (
    name: string,
    processor: (job: { data: DiagnosticsListenerJobData }) => Promise<void>,
    opts: Record<string, unknown>,
  ) => WorkerLike;
}

export const DEFAULT_QUEUE = 'aviary-diagnostics';
export const LISTENER_JOB_NAME = 'aviary.diagnostics.listener';

/** BullMQ job id of a delivery: unique per `(event id, listener)`, so re-adding is a no-op. */
export function deliveryJobId(delivery: ListenerDelivery): string {
  // BullMQ refuses custom ids containing ':'.
  return `diag.${delivery.envelope.id}.${delivery.listenerId}`.replaceAll(':', '.');
}

export function createQueueTransport(
  bullmq: BullmqModuleLike,
  config: QueueTransportConfig,
  ctx: TransportContext,
): TransportHandle {
  const name = config.queue ?? DEFAULT_QUEUE;
  const base: Record<string, unknown> = {
    connection: config.connection,
    ...(config.prefix !== undefined ? { prefix: config.prefix } : {}),
  };
  const jobOptions = {
    attempts: (config.retries ?? 3) + 1,
    backoff: config.backoff ?? { type: 'exponential' as const, delay: 1000 },
    removeOnComplete: config.removeOnComplete ?? true,
    removeOnFail: config.removeOnFail ?? false,
  };

  const queue = new bullmq.Queue(name, base);
  queue.on('error', (error) => ctx.logger.error(`diagnostics queue error: ${error.message}`));

  // An 'api' process enqueues only: no worker, so listeners never run here.
  const worker =
    ctx.role === 'api'
      ? null
      : new bullmq.Worker(name, (job) => ctx.invoke(job.data.listenerId, job.data.envelope), {
          ...base,
          concurrency: config.concurrency ?? 1,
        });
  worker?.on('error', (error) => ctx.logger.error(`diagnostics worker error: ${error.message}`));
  worker?.on('failed', (job, error) =>
    ctx.logger.error(
      `diagnostics listener ${job?.data.listenerId ?? '?'} failed for event ${job?.data.envelope.id ?? '?'}: ${error.message}`,
    ),
  );

  return {
    async deliver(deliveries) {
      await queue.addBulk(
        deliveries.map((delivery) => ({
          name: LISTENER_JOB_NAME,
          data: { listenerId: delivery.listenerId, envelope: delivery.envelope },
          opts: { ...jobOptions, jobId: deliveryJobId(delivery) },
        })),
      );
    },
    async stop() {
      await worker?.close();
      await queue.close();
    },
  };
}
