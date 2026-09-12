/**
 * Anti-drift latch for contract tests: asserts that EVERY token a lib exports
 * follows the canonical `@dudousxd/nestjs-<lib>:<name>` naming. Because
 * `Symbol.for(k).description === k`, checking the `description` prefix is enough —
 * no identity comparison needed. Throws an error that NAMES the offending export,
 * turning drift into a red test.
 *
 * It checks the NAME, not the provenance: a symbol spelled by hand with the right
 * prefix passes exactly like one built by `capability(lib, ...)`. That is the
 * point — the canonical name is the contract, not the factory call.
 */
export function assertCapabilityNaming(lib: string, tokens: Record<string, symbol>): void {
  const prefix = `@dudousxd/nestjs-${lib}:`;
  for (const [exportName, token] of Object.entries(tokens)) {
    const desc = token.description;
    if (desc === undefined || !desc.startsWith(prefix)) {
      throw new Error(
        `Capability token "${exportName}" has description ${JSON.stringify(desc)}, ` +
          `expected to start with "${prefix}". Use capability('${lib}', <name>).`,
      );
    }
  }
}
