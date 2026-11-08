import diagnostics_channel from 'node:diagnostics_channel';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_PREFIX,
  NESTJS_RESILIENCE_CHANNELS,
  OFFICIAL_CHANNELS,
  OFFICIAL_PACKAGE_VERSIONS,
  type OfficialDiagnosticEvent,
  type OfficialLib,
  officialChannelNames,
  registeredChannels,
  setContextAccessor,
  subscribeOfficial,
} from '../src/index.js';

const require = createRequire(import.meta.url);

/** The installed package's root (its `exports` hides package.json, so walk up from the entry). */
function packageRoot(lib: OfficialLib): string {
  let dir = dirname(require.resolve(`@nestjs/${lib}`));
  while (!readdirSync(dir).includes('package.json')) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no package.json above the @nestjs/${lib} entry`);
    dir = parent;
  }
  return dir;
}

function read(lib: OfficialLib, file: string): string {
  return readFileSync(join(packageRoot(lib), 'dist', file), 'utf8');
}

function quoted(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => m[1] as string);
}

/**
 * What the INSTALLED (pinned) official package actually publishes, read from its
 * dist. Each extractor targets the file the channel list was verified from, so a
 * new/renamed channel — or a restructure that hides it — fails here.
 */
const extract: Record<OfficialLib, () => string[]> = {
  resilience: () => {
    const src = read('resilience', 'events/resilience.channels.js');
    expect(src).toContain('channel(`nestjs:resilience:${type}`)');
    const types = /const TYPES = \[([\s\S]*?)\]/.exec(src)?.[1] ?? '';
    return quoted(types, /'([^']+)'/g);
  },
  workflows: () => {
    expect(read('workflows', 'events/workflows.channels.js')).toContain(
      'channel(`nestjs:workflows:${type}`)',
    );
    return quoted(read('workflows', 'events/workflow-events.interface.d.ts'), /type: '([^']+)';/g);
  },
  authentication: () => {
    expect(read('authentication', 'events/authentication.channels.js')).toContain(
      'channel(`nestjs:authentication:${type}`)',
    );
    const dir = join(packageRoot('authentication'), 'dist', 'events');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.d.ts'))
      .flatMap((f) => quoted(readFileSync(join(dir, f), 'utf8'), /type: '([^']+)';/g));
  },
  authorization: () =>
    quoted(
      read('authorization', 'events/authorization.channels.js'),
      /channel\('nestjs:authorization:([^']+)'\)/g,
    ),
  mail: () => quoted(read('mail', 'events/mail.channels.js'), /channel\('nestjs:mail:([^']+)'\)/g),
};

afterEach(() => {
  setContextAccessor(null);
  vi.restoreAllMocks();
});

describe('official channel lists (pinned drift guard)', () => {
  it('lists the counts the first-party packages publish', () => {
    const counts = Object.fromEntries(
      Object.entries(OFFICIAL_CHANNELS).map(([lib, map]) => [lib, Object.keys(map).length]),
    );
    expect(counts).toEqual({
      resilience: 9,
      workflows: 19,
      authentication: 13,
      authorization: 1,
      mail: 2,
    });
  });

  for (const lib of Object.keys(OFFICIAL_CHANNELS) as OfficialLib[]) {
    it(`@nestjs/${lib}: installed version is the pinned one`, () => {
      const pkg = JSON.parse(readFileSync(join(packageRoot(lib), 'package.json'), 'utf8')) as {
        version: string;
      };
      // Bumping the devDependency must come with re-verifying the list below.
      expect(pkg.version).toBe(OFFICIAL_PACKAGE_VERSIONS[lib]);
    });

    it(`@nestjs/${lib}: publishes exactly the listed channels`, () => {
      const actual = [...new Set(extract[lib]())].sort();
      expect(actual).toEqual(Object.keys(OFFICIAL_CHANNELS[lib]).sort());
      for (const [type, name] of Object.entries(OFFICIAL_CHANNELS[lib])) {
        expect(name).toBe(`nestjs:${lib}:${type}`);
      }
    });
  }

  it('every official name is on nestjs:*, never on the Aviary prefix', () => {
    for (const name of officialChannelNames()) {
      expect(name.startsWith('nestjs:')).toBe(true);
      expect(name.startsWith(`${CHANNEL_PREFIX}:`)).toBe(false);
    }
  });
});

describe('subscribeOfficial', () => {
  it('wraps a raw official payload in the Aviary envelope with the context traceId', () => {
    setContextAccessor({
      traceId: () => 'trace-123',
      tenantId: () => undefined,
      userRef: () => undefined,
      get: () => undefined,
    });
    const seen: Array<[OfficialDiagnosticEvent, string]> = [];
    const off = subscribeOfficial('mail', ['sent'], (e, name) => seen.push([e, name]));

    const payload = { type: 'sent', messageId: 'm1' };
    diagnostics_channel.channel('nestjs:mail:sent').publish(payload);
    diagnostics_channel.channel('nestjs:mail:failed').publish({ type: 'failed' });
    off();
    diagnostics_channel.channel('nestjs:mail:sent').publish(payload);

    expect(seen).toHaveLength(1);
    const [event, name] = seen[0] as [OfficialDiagnosticEvent, string];
    expect(name).toBe('nestjs:mail:sent');
    expect(event).toMatchObject({
      v: 1,
      lib: 'mail',
      event: 'sent',
      traceId: 'trace-123',
      source: 'nestjs',
    });
    expect(event.payload).toBe(payload);
    expect(typeof event.ts).toBe('number');
    expect('durationMs' in event).toBe(false);
  });

  it("'all' subscribes every channel of the lib and lifts a numeric durationMs", () => {
    const events: string[] = [];
    let duration: number | undefined;
    const off = subscribeOfficial('workflows', 'all', (e) => {
      events.push(e.event);
      duration = e.durationMs ?? duration;
    });
    for (const name of Object.values(OFFICIAL_CHANNELS.workflows)) {
      expect(diagnostics_channel.channel(name).hasSubscribers).toBe(true);
    }
    diagnostics_channel
      .channel('nestjs:workflows:step-completed')
      .publish({ type: 'step-completed', durationMs: 42 });
    off();
    expect(events).toEqual(['step-completed']);
    expect(duration).toBe(42);
    expect(diagnostics_channel.channel('nestjs:workflows:step-completed').hasSubscribers).toBe(
      false,
    );
  });

  it('isolates a throwing listener from the official publisher', () => {
    const off = subscribeOfficial('authorization', ['denied'], () => {
      throw new Error('boom');
    });
    expect(() =>
      diagnostics_channel.channel('nestjs:authorization:denied').publish({}),
    ).not.toThrow();
    off();
  });

  it('rejects unknown libs, unknown types and an empty selection', () => {
    expect(() => subscribeOfficial('nope' as OfficialLib, 'all', () => {})).toThrow(/unknown/);
    // @ts-expect-error — not a resilience channel
    expect(() => subscribeOfficial('resilience', ['sent'], () => {})).toThrow(/no 'sent'/);
    expect(() => subscribeOfficial('resilience', [], () => {})).toThrow(
      /no 'resilience' channel selected/,
    );
  });

  it('does not touch the aviary registry', () => {
    const before = registeredChannels().length;
    subscribeOfficial('authentication', 'all', () => {})();
    expect(registeredChannels().length).toBe(before);
  });

  it('receives events from the real @nestjs/resilience publisher', async () => {
    const { RetryPolicy } = (await import('@nestjs/resilience')) as typeof import(
      '@nestjs/resilience',
    );
    const retries: OfficialDiagnosticEvent[] = [];
    const off = subscribeOfficial('resilience', ['retry'], (e) => retries.push(e));
    let calls = 0;
    const policy = new RetryPolicy({ attempts: 3, backoff: () => 1 });
    await policy.execute(() => {
      calls++;
      if (calls < 2) throw new Error('flaky');
      return 'ok';
    });
    off();
    expect(retries.length).toBeGreaterThanOrEqual(1);
    expect(retries[0]).toMatchObject({ lib: 'resilience', event: 'retry', source: 'nestjs' });
    expect((retries[0]?.payload as { type?: string }).type).toBe('retry');
    expect(NESTJS_RESILIENCE_CHANNELS.retry).toBe('nestjs:resilience:retry');
  });
});
