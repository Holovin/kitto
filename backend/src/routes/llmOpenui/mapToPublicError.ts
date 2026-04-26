import { logServerError, toPublicErrorPayload } from '#backend/errors/publicError.js';

export function mapToPublicError(error: unknown, scope: string) {
  logServerError(error, scope);
  return toPublicErrorPayload(error);
}
