import { Inject, Optional } from '@nestjs/common';
import { capability } from './capability.js';

/**
 * Injects a peer lib's `<lib>:<name>` capability OPTIONALLY — equivalent to
 * `@Optional() @Inject(capability(lib, name))`, without the magic string copied by
 * hand. When the producer lib is absent, the parameter receives `undefined`
 * instead of breaking injection.
 *
 * The decorator carries no type of its own: annotate the parameter on the consumer
 * side, e.g. with {@link import('./capability.js').CapabilityOf CapabilityOf}.
 *
 * Exported from the `/nestjs` subpath only, never from the main barrel: this file
 * imports `@nestjs/common`, and the root entry point stays Nest-free.
 */
export function InjectCapability(lib: string, name: string): ParameterDecorator {
  const token = capability(lib, name);
  return (target, propertyKey, parameterIndex) => {
    Optional()(target, propertyKey, parameterIndex);
    Inject(token)(target, propertyKey, parameterIndex);
  };
}
