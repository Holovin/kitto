import type { Context } from 'hono';
import type { AppEnv } from '../../env.js';
import { toPublicErrorPayload } from '../../errors/publicError.js';
import { createRequestId } from '../../requestMetadata.js';
import { createCommitTelemetryRegistry } from '../../services/commitTelemetryRegistry.js';
import { writePromptIoCommitTelemetrySafely, writePromptIoIntakeFailureSafely } from '../../services/openai/logging.js';
import { mapToPublicError } from './mapToPublicError.js';
import { parseCommitTelemetryRequest, type ParsedCommitTelemetryRequest } from './requestSchema.js';

const COMMIT_TELEMETRY_SCOPE = 'POST /api/llm/commit-telemetry';

export interface IntakeFailureOptions {
  compactedRequestBytes?: number | null;
  error?: unknown;
  errorCode?: string;
  errorMessage?: string;
  omittedChatMessages?: number | null;
  partialBody?: unknown;
  requestBytes?: number | null;
  requestId: string;
}

export interface IntakeFailureRecorder {
  recordIntake(options: IntakeFailureOptions): Promise<void>;
}

export interface LlmOpenUiTelemetry extends IntakeFailureRecorder {
  consumeCommitTelemetry(requestId: string): ReturnType<
    ReturnType<typeof createCommitTelemetryRegistry>['consumeTelemetry']
  >;
  recordCommit(request: ParsedCommitTelemetryRequest): Promise<void>;
  recordModelResponse(requestId: string): void;
}

export function createLlmOpenUiTelemetry(env: AppEnv): LlmOpenUiTelemetry {
  const commitTelemetryRegistry = createCommitTelemetryRegistry();

  return {
    async recordIntake(options) {
      const publicError = options.error
        ? toPublicErrorPayload(options.error)
        : {
            code: options.errorCode ?? 'internal_error',
            error: options.errorMessage ?? 'Internal server error.',
          };

      await writePromptIoIntakeFailureSafely(env, {
        compactedRequestBytes: options.compactedRequestBytes,
        omittedChatMessages: options.omittedChatMessages,
        errorCode: publicError.code,
        errorMessage: publicError.error,
        partialBody: options.partialBody,
        requestBytes: options.requestBytes ?? null,
        requestId: options.requestId,
      });
    },
    consumeCommitTelemetry(requestId) {
      return commitTelemetryRegistry.consumeTelemetry(requestId);
    },
    async recordCommit(request) {
      await writePromptIoCommitTelemetrySafely(env, {
        commitSource: request.commitSource,
        committed: request.committed,
        parentRequestId: request.requestId,
        repairOutcome: request.repairOutcome,
        requestId: createRequestId(),
        validationIssues: request.validationIssues,
      });
    },
    recordModelResponse(requestId) {
      commitTelemetryRegistry.registerCompletedRequest(requestId);
    },
  };
}

export function createCommitTelemetryHandler(telemetry: LlmOpenUiTelemetry) {
  return async function handleCommitTelemetry(context: Context) {
    try {
      const telemetryRequest = await parseCommitTelemetryRequest(context);
      const telemetryPermission = telemetry.consumeCommitTelemetry(telemetryRequest.requestId);

      if (!telemetryPermission.ok) {
        return context.json(
          {
            code: 'validation_error',
            error:
              telemetryPermission.reason === 'event_limit_reached'
                ? 'Commit telemetry for this generation request was already accepted too many times.'
                : 'Commit telemetry request does not match a completed generation request.',
            status: 409,
          },
          409,
        );
      }

      await telemetry.recordCommit(telemetryRequest);
      return context.json({ ok: true }, 202);
    } catch (error) {
      const publicError = mapToPublicError(error, COMMIT_TELEMETRY_SCOPE);
      return context.json(publicError, publicError.status);
    }
  };
}
