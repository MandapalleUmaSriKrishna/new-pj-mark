/** Schema validation helpers that turn zod failures into ApiError responses. */
import { errors } from '../errors.js';

const FRIENDLY_MESSAGES = {
  phone: 'Enter a phone number.',
  country: 'Select a country.',
  code: 'Enter the 6-digit code from the SMS.',
};

const GENERIC_MESSAGES = new Set(['Required', 'Invalid input', 'Invalid']);

/**
 * @param {import('zod').ZodTypeAny} schema
 * @param {unknown} payload
 */
export function validate(schema, payload) {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  /** @type {Record<string,string>} */
  const fields = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? 'request');
    if (fields[field]) continue;
    const friendly = FRIENDLY_MESSAGES[field];
    fields[field] = friendly && GENERIC_MESSAGES.has(issue.message) ? friendly : issue.message;
  }

  const first = Object.values(fields)[0] ?? 'Check the highlighted fields and try again.';
  throw errors.invalidRequest(first, { fields });
}
