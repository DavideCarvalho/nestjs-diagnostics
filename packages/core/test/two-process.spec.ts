import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DURABLE_NOT_INSTALLED } from '../src/nestjs/transports.js';

/**
 * Several real Node processes, one event. Runs the built package (`dist/`); the Redis cases need
 * `REDIS_URL` (CI provides a Redis service).
 */
const REDIS_URL = process.env.REDIS_URL;
const fixture = fileURLToPath(new URL('./fixtures/two-process/node.mjs', import.meta.url));
const built = existsSync(fileURLToPath(new URL('../dist/nestjs/index.js', import.meta.url)));

interface Message {
  name: string;
  ready?: boolean;
  bootError?: string;
  invoked?: { id: string; payload: unknown; failed: boolean };
}

class Node {
  readonly messages: Message[] = [];
  private readonly child: ChildProcessWithoutNullStreams;
  private waiters: Array<() => void> = [];

  constructor(mode: string, role: string, name: string, namespace: string) {
    this.child = spawn(process.execPath, [fixture, mode, role, name, REDIS_URL ?? '', namespace]);
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      this.messages.push(JSON.parse(line) as Message);
      for (const wake of this.waiters.splice(0)) wake();
    });
    this.child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  }

  async waitFor(predicate: (messages: Message[]) => boolean, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this.messages)) {
      if (Date.now() > deadline) {
        throw new Error(`timed out; got ${JSON.stringify(this.messages)}`);
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  }

  ready(): Promise<void> {
    return this.waitFor((m) => m.some((x) => x.ready || x.bootError));
  }

  emit(payload: unknown): void {
    this.child.stdin.write(`emit ${JSON.stringify(payload)}\n`);
  }

  invocations(): NonNullable<Message['invoked']>[] {
    return this.messages.flatMap((m) => (m.invoked ? [m.invoked] : []));
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.stdin.write('stop\n');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    this.child.kill();
  }
}

const nodes: Node[] = [];
const start = async (mode: string, role: string, name: string, namespace: string) => {
  const node = new Node(mode, role, name, namespace);
  nodes.push(node);
  await node.ready();
  return node;
};
const namespace = () => `diag-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop()));
});

describe.skipIf(!built)('separate processes', () => {
  it('transports.durable() selected without the durable package fails the bootstrap', async () => {
    const node = await start('durable', 'all', 'web', namespace());
    expect(node.messages[0]?.bootError).toBe(DURABLE_NOT_INSTALLED);
  }, 30_000);

  describe.skipIf(!REDIS_URL)('on real Redis', () => {
    it('redis: one event runs the listener in every process, with the same id', async () => {
      const ns = namespace();
      const web = await start('redis', 'all', 'web', ns);
      const worker = await start('redis', 'worker', 'worker', ns);
      web.emit({ run: 1 });
      await web.waitFor(() => web.invocations().length === 1);
      await worker.waitFor(() => worker.invocations().length === 1);
      await settle(300);
      expect(web.invocations()).toHaveLength(1);
      expect(worker.invocations()).toHaveLength(1);
      expect(worker.invocations()[0]?.id).toBe(web.invocations()[0]?.id);
      expect(worker.invocations()[0]?.payload).toEqual({ run: 1 });
    }, 30_000);

    it("redis: role 'api' publishes but never runs listeners", async () => {
      const ns = namespace();
      const api = await start('redis', 'api', 'api', ns);
      const worker = await start('redis', 'worker', 'worker', ns);
      api.emit({ run: 2 });
      await worker.waitFor(() => worker.invocations().length === 1);
      await settle(300);
      expect(api.invocations()).toHaveLength(0);
    }, 30_000);

    it('queue: one event runs once across workers, retried after a thrown error', async () => {
      const ns = namespace();
      const api = await start('queue', 'api', 'api', ns);
      const w1 = await start('queue', 'worker', 'w1', ns);
      const w2 = await start('queue', 'worker', 'w2', ns);
      api.emit({ run: 3 });
      const all = () => [...w1.invocations(), ...w2.invocations()];
      await w1.waitFor(() => all().some((i) => !i.failed));
      await settle(500);
      expect(api.invocations()).toHaveLength(0);
      expect(all()).toHaveLength(2);
      expect(all().filter((i) => i.failed)).toHaveLength(1);
      expect(new Set(all().map((i) => i.id)).size).toBe(1);
    }, 30_000);
  });
});
