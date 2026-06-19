/**
 * Trava anti-drift para contract tests: assere que TODO token exportado por uma
 * lib segue o naming canônico `@dudousxd/nestjs-<lib>:<name>` (i.e. foi criado
 * por `capability(lib, ...)`). `Symbol.for(k).description === k`, então basta
 * checar o prefixo da `description` — não é preciso comparar identidade.
 * Lança um erro que NOMEIA o export ofensor, virando o drift em teste vermelho.
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
