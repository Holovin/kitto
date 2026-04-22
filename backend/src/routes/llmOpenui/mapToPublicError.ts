import { logServerError, toPublicErrorPayload } from '../../errors/publicError.js';

export function mapToPublicError(error: unknown, scope: string) {
  logServerError(error, scope);
  return toPublicErrorPayload(error);
}
