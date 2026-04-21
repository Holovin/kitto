const DEFAULT_COMMIT_TELEMETRY_MAX_EVENTS = 3;
const DEFAULT_COMMIT_TELEMETRY_TTL_MS = 15 * 60 * 1000;

interface CommitTelemetryRegistryOptions {
  maxEventsPerRequest?: number;
  ttlMs?: number;
}

interface CommitTelemetryRequestRecord {
  acceptedEvents: number;
  clientKey: string;
  expiresAt: number;
}

type CommitTelemetryConsumeResult =
  | { ok: true }
  | { ok: false; reason: 'client_mismatch' | 'event_limit_reached' | 'unknown_request' };

export function createCommitTelemetryRegistry({
  maxEventsPerRequest = DEFAULT_COMMIT_TELEMETRY_MAX_EVENTS,
  ttlMs = DEFAULT_COMMIT_TELEMETRY_TTL_MS,
}: CommitTelemetryRegistryOptions = {}) {
  const requestRecords = new Map<string, CommitTelemetryRequestRecord>();

  function prune(now = Date.now()) {
    for (const [requestId, record] of requestRecords) {
      if (record.expiresAt <= now) {
        requestRecords.delete(requestId);
      }
    }
  }

  function registerCompletedRequest(requestId: string, clientKey: string, now = Date.now()) {
    prune(now);
    requestRecords.set(requestId, {
      acceptedEvents: 0,
      clientKey,
      expiresAt: now + ttlMs,
    });
  }

  function consumeTelemetry(requestId: string, clientKey: string, now = Date.now()): CommitTelemetryConsumeResult {
    prune(now);
    const requestRecord = requestRecords.get(requestId);

    if (!requestRecord) {
      return {
        ok: false,
        reason: 'unknown_request',
      };
    }

    if (requestRecord.clientKey !== clientKey) {
      return {
        ok: false,
        reason: 'client_mismatch',
      };
    }

    if (requestRecord.acceptedEvents >= maxEventsPerRequest) {
      return {
        ok: false,
        reason: 'event_limit_reached',
      };
    }

    requestRecord.acceptedEvents += 1;
    requestRecord.expiresAt = now + ttlMs;

    return {
      ok: true,
    };
  }

  return {
    consumeTelemetry,
    registerCompletedRequest,
  };
}
