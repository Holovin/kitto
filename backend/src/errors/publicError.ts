import { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import { ZodError } from 'zod';

type PublicErrorCode = 'internal_error' | 'timeout_error' | 'upstream_error' | 'validation_error';
type ValidationStatus = 400 | 413;
type PublicErrorStatus = ValidationStatus | 500 | 502 | 504;

interface PublicError {
  code: PublicErrorCode;
  message: string;
  status: PublicErrorStatus;
}

interface PublicErrorPayload {
  code: PublicErrorCode;
  error: string;
  status: PublicErrorStatus;
}

interface RequestValidationErrorOptions {
  publicMessage?: string;
}

export const REQUEST_BODY_TOO_LARGE_PUBLIC_MESSAGE = 'Request body is too large to process safely.';

export class RequestValidationError extends Error {
  readonly publicMessage: string;
  readonly status: ValidationStatus;

  constructor(message: string, status: ValidationStatus = 400, options?: RequestValidationErrorOptions) {
    super(message);
    this.name = 'RequestValidationError';
    this.status = status;
    this.publicMessage = options?.publicMessage ?? message;
  }
}

export class UpstreamFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamFailureError';
  }
}

export function createRequestBodyTooLargeError(message: string) {
  return new RequestValidationError(message, 413, {
    publicMessage: REQUEST_BODY_TOO_LARGE_PUBLIC_MESSAGE,
  });
}

function formatPathMaximum(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getValidationMessage(error: ZodError) {
  const tooBigIssues = error.issues.filter((issue) => issue.code === 'too_big');

  const promptIssue = tooBigIssues.find((issue) => issue.path[0] === 'prompt');
  if (promptIssue) {
    return promptIssue.message.trim() || 'Prompt is too large.';
  }

  const validationIssuesLengthIssue = tooBigIssues.find(
    (issue) => issue.path[0] === 'validationIssues' && issue.path.length === 1,
  );
  if (validationIssuesLengthIssue) {
    const maximum = formatPathMaximum((validationIssuesLengthIssue as { maximum?: unknown }).maximum);
    return maximum === null ? 'Too many validation issues to send.' : `Too many validation issues to send (max ${maximum}).`;
  }

  if (tooBigIssues.some((issue) => issue.path[0] === 'validationIssues' && issue.path.length > 1)) {
    return 'A validation issue field is too long.';
  }

  if (tooBigIssues.some((issue) => issue.path[0] === 'chatHistory')) {
    return 'Chat history is too large.';
  }

  if (tooBigIssues.length > 0) {
    return REQUEST_BODY_TOO_LARGE_PUBLIC_MESSAGE;
  }

  return 'The request payload is invalid.';
}

function isBodyLimitError(error: unknown) {
  return error instanceof Error && error.name === 'BodyLimitError';
}

function isTimeoutError(error: unknown) {
  if (error instanceof APIConnectionTimeoutError) {
    return true;
  }

  return error instanceof Error && (error.name === 'APIConnectionTimeoutError' || error.name === 'TimeoutError');
}

function toPublicError(error: unknown): PublicError {
  if (isBodyLimitError(error)) {
    return {
      code: 'validation_error',
      message: REQUEST_BODY_TOO_LARGE_PUBLIC_MESSAGE,
      status: 413,
    };
  }

  if (error instanceof RequestValidationError) {
    return {
      code: 'validation_error',
      message: error.publicMessage,
      status: error.status,
    };
  }

  if (error instanceof ZodError) {
    return {
      code: 'validation_error',
      message: getValidationMessage(error),
      status: 400,
    };
  }

  if (isTimeoutError(error)) {
    return {
      code: 'timeout_error',
      message: 'The model request timed out.',
      status: 504,
    };
  }

  if (error instanceof UpstreamFailureError || error instanceof APIConnectionError || error instanceof APIError) {
    return {
      code: 'upstream_error',
      message: 'The model service could not complete the request.',
      status: 502,
    };
  }

  return {
    code: 'internal_error',
    message: 'Internal server error.',
    status: 500,
  };
}

export function toPublicErrorPayload(error: unknown): PublicErrorPayload {
  const publicError = toPublicError(error);

  return {
    code: publicError.code,
    error: publicError.message,
    status: publicError.status,
  };
}

export function logServerError(error: unknown, scope: string) {
  const publicError = toPublicError(error);
  const logMethod = publicError.code === 'validation_error' ? console.warn : console.error;

  logMethod(`[${scope}] ${publicError.status} ${publicError.code}`, error);
}
