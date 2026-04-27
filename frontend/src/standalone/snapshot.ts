import { normalizeStandaloneDomainData, normalizeStandaloneRuntimeState } from '@pages/Chat/builder/standalone/types';

export type StandaloneSnapshot = {
  domainData: Record<string, unknown>;
  runtimeState: Record<string, unknown>;
};

export type StandaloneSnapshotUpdate = {
  domainData?: unknown;
  runtimeState?: unknown;
};

function hasSnapshotUpdate<K extends keyof StandaloneSnapshotUpdate>(update: StandaloneSnapshotUpdate, key: K) {
  return Object.prototype.hasOwnProperty.call(update, key);
}

export function createStandaloneSnapshot(runtimeState: unknown, domainData: unknown): StandaloneSnapshot {
  return {
    runtimeState: normalizeStandaloneRuntimeState(runtimeState),
    domainData: normalizeStandaloneDomainData(domainData),
  };
}

export function mergeStandaloneSnapshot(
  currentSnapshot: StandaloneSnapshot,
  update: StandaloneSnapshotUpdate,
): StandaloneSnapshot {
  return {
    runtimeState: hasSnapshotUpdate(update, 'runtimeState')
      ? normalizeStandaloneRuntimeState(update.runtimeState)
      : currentSnapshot.runtimeState,
    domainData: hasSnapshotUpdate(update, 'domainData')
      ? normalizeStandaloneDomainData(update.domainData)
      : currentSnapshot.domainData,
  };
}

export function isStandaloneSnapshotUpdateKey(
  update: StandaloneSnapshotUpdate,
  key: keyof StandaloneSnapshotUpdate,
): boolean {
  return hasSnapshotUpdate(update, key);
}
