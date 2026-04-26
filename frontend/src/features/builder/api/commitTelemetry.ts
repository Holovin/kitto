import type { BuilderCommitRepairOutcome, BuilderCommitSource, BuilderRequestId } from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';

interface PostCommitTelemetryOptions {
  commitSource: BuilderCommitSource;
  committed: boolean;
  qualityWarnings?: string[];
  repairOutcome?: BuilderCommitRepairOutcome;
  requestId: BuilderRequestId;
  validationIssues: string[];
}

export async function postCommitTelemetry({
  commitSource,
  committed,
  qualityWarnings = [],
  repairOutcome,
  requestId,
  validationIssues,
}: PostCommitTelemetryOptions) {
  try {
    await fetch(`${getBackendApiBaseUrl()}/llm/commit-telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-kitto-request-id': requestId,
      },
      body: JSON.stringify({
        commitSource,
        committed,
        qualityWarnings,
        ...(repairOutcome ? { repairOutcome } : {}),
        requestId,
        validationIssues,
      }),
    });
  } catch {
    // Commit telemetry must never block the builder UX.
  }
}
