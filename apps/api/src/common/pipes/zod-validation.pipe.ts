import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from '../errors/app.exception';

/**
 * Zod validation pipe.
 *
 * The shared package owns the schemas so the browser and the server validate
 * with exactly the same rules - a value the designer accepts cannot be rejected
 * by the API and vice versa. Output is the *parsed* value, which means defaults
 * are applied and unknown keys are stripped before any service sees them.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: ZodType<T>,
    private readonly label = 'Request',
  ) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
        code: issue.code,
      }));
      throw AppException.validationFailed(`${this.label} validation failed`, details);
    }
    return result.data;
  }
}

/** Convenience factory for use inside a controller signature. */
export function validateWith<T>(schema: ZodType<T>, label = 'Request'): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema, label);
}
