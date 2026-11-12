/**
 * Which half of a split deployment this process is:
 *
 * - `'all'` (default): emit, forward, consume and run listeners. One process does everything.
 * - `'api'`: emit and forward through the selected transport, and hand listener work to it;
 *   never consume what other processes forward, never run a listener.
 * - `'worker'`: consume and run listeners. Diagnostics mounts no HTTP surface, so a worker does
 *   everything `'all'` does; the role exists so one setting drives every library of the app.
 */
export type DiagnosticsRole = 'all' | 'api' | 'worker';

const ROLES: readonly DiagnosticsRole[] = ['all', 'api', 'worker'];

/** Validate `role` (default `'all'`) and refuse combinations that cannot work. */
export function resolveRole(
  role: DiagnosticsRole | undefined,
  transport: string | undefined,
): DiagnosticsRole {
  const resolved = role ?? 'all';
  if (!ROLES.includes(resolved)) {
    throw new Error(
      `@dudousxd/nestjs-diagnostics: role must be 'all', 'api' or 'worker' (got ${JSON.stringify(role)})`,
    );
  }
  if (resolved !== 'all' && !transport) {
    throw new Error(
      `@dudousxd/nestjs-diagnostics: role is "${resolved}", which splits emitting from consuming, but no \`default\` transport is selected, so nothing carries events between the two halves. Select a transport with \`default\`, or drop \`role\`.`,
    );
  }
  return resolved;
}
