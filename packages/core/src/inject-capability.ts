import { Inject, Optional } from '@nestjs/common';
import { capability } from './capability.js';

/**
 * Injeta a capability de um peer `<lib>:<name>` OPCIONALMENTE — equivale a
 * `@Optional() @Inject(capability(lib, name))`, sem a string mágica copiada à
 * mão. Quando o produtor (a outra lib) está ausente, o parâmetro recebe
 * `undefined` em vez de quebrar a injeção. O tipo do parâmetro é anotado pelo
 * consumidor (ver nota no plano sobre declaration merging cross-repo).
 */
export function InjectCapability(lib: string, name: string): ParameterDecorator {
  const token = capability(lib, name);
  return (target, propertyKey, parameterIndex) => {
    Optional()(target, propertyKey, parameterIndex);
    Inject(token)(target, propertyKey, parameterIndex);
  };
}
