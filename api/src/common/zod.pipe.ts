import { HttpStatus, PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/** Valida o corpo da requisição com um schema zod. Erros viram 422 com a lista por campo. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;

    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || '_root';
      (errors[path] ??= []).push(issue.message);
    }
    throw new UnprocessableEntityException({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: 'Dados inválidos',
      errors,
    });
  }
}
