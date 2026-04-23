import type { BuilderCommitRepairOutcome, BuilderCommitSource, BuilderRequestId } from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';

interface PostCommitTelemetryOptions {
  commitSource: BuilderCommitSource;
  committed: boolean;
  repairOutcome?: BuilderCommitRepairOutcome;
  requestId: BuilderRequestId;
  validationIssues: string[];
}

export async function postCommitTelemetry({
  commitSource,
  committed,
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
      },
      body: JSON.stringify({
        commitSource,
        committed,
        ...(repairOutcome ? { repairOutcome } : {}),
        requestId,
        validationIssues,
      }),
    });
  } catch {
    // Commit telemetry must never block the builder UX.
  }
}
