import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const project = fileURLToPath(new URL('./fixtures/listener-types/tsconfig.json', import.meta.url));

describe('@OnDiagnostic types', () => {
  it('checks the handler against the ChannelRegistry payload', async () => {
    const run = promisify(execFile)(process.execPath, [tsc, '-p', project]);
    await expect(run.then(() => 'ok')).resolves.toBe('ok');
  }, 60_000);
});
