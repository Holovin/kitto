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

function createStandaloneAppId(source: string) {
  const hashInput = `${KITTO_STANDALONE_PAYLOAD_KIND}:${KITTO_STANDALONE_PAYLOAD_VERSION}:${source}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < hashInput.length; index += 1) {
    hash ^= hashInput.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `v${KITTO_STANDALONE_PAYLOAD_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
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
  const appId = createStandaloneAppId(committedSource);

  return {
    version: KITTO_STANDALONE_PAYLOAD_VERSION,
    kind: KITTO_STANDALONE_PAYLOAD_KIND,
    appId,
    title: resolveStandaloneTitle(title),
    createdAt: new Date().toISOString(),
    source: committedSource,
    initialRuntimeState: baselineSnapshot ? normalizeStandaloneRuntimeState(baselineSnapshot.initialRuntimeState) : {},
    initialDomainData: baselineSnapshot ? normalizeStandaloneDomainData(baselineSnapshot.initialDomainData) : {},
    storageKey: `kitto:standalone:${appId}`,
  };
}
