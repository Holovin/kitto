import type { BuilderSnapshot } from '@features/builder/types';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import {
  DEFAULT_STANDALONE_APP_TITLE,
  KITTO_STANDALONE_PAYLOAD_KIND,
  KITTO_STANDALONE_PAYLOAD_VERSION,
  normalizeStandaloneDomainData,
  normalizeStandaloneRuntimeState,
  type KittoStandalonePayload,
} from './types';

type CreateStandalonePayloadOptions = {
  committedSource: string;
  history: BuilderSnapshot[];
  title?: string;
};

function resolveStandaloneTitle(title?: string) {
  const trimmedTitle = title?.trim();
  return trimmedTitle || DEFAULT_STANDALONE_APP_TITLE;
}

function createStandaloneExportId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();

  if (typeof randomUuid === 'string' && randomUuid.length > 0) {
    return `v${KITTO_STANDALONE_PAYLOAD_VERSION}-${randomUuid}`;
  }

  const timestampPart = Date.now().toString(36);
  const randomPart = Math.floor(Math.random() * 0x1_0000_0000)
    .toString(16)
    .padStart(8, '0');

  return `v${KITTO_STANDALONE_PAYLOAD_VERSION}-${timestampPart}-${randomPart}`;
}

function getLatestCommittedSnapshotForSource(source: string, history: BuilderSnapshot[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const snapshot = history[index];

    if (snapshot?.source === source) {
      return snapshot;
    }
  }

  return null;
}

export function createStandalonePayload({
  committedSource,
  history,
  title,
}: CreateStandalonePayloadOptions): KittoStandalonePayload {
  const sourceValidation = validateOpenUiSource(committedSource);

  if (!sourceValidation.isValid) {
    throw new Error('Current committed definition is invalid.');
  }

  const baselineSnapshot = getLatestCommittedSnapshotForSource(committedSource, history);
  const exportId = createStandaloneExportId();
  const createdAt = new Date().toISOString();

  return {
    version: KITTO_STANDALONE_PAYLOAD_VERSION,
    kind: KITTO_STANDALONE_PAYLOAD_KIND,
    exportId,
    title: resolveStandaloneTitle(title),
    createdAt,
    source: committedSource,
    initialRuntimeState: baselineSnapshot ? normalizeStandaloneRuntimeState(baselineSnapshot.initialRuntimeState) : {},
    initialDomainData: baselineSnapshot ? normalizeStandaloneDomainData(baselineSnapshot.initialDomainData) : {},
    storageKey: `kitto:standalone:${exportId}`,
  };
}
