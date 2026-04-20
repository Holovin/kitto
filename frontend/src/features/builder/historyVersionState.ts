import type { BuilderSnapshot } from '@features/builder/types';

export interface BuilderHistoryVersionStateInput {
  committedSource: string;
  hasRejectedDefinition?: boolean;
  hasRedoSnapshot: boolean;
  hasUndoSnapshot: boolean;
  historyVersionCount: number;
  isStreaming: boolean;
  redoVersionCount: number;
}

export interface BuilderHistoryVersionState {
  canRedo: boolean;
  canReset: boolean;
  canUndo: boolean;
  currentVersionNumber: number;
  totalVersionCount: number;
  versionBadgeText: string;
}

export function countCommittedVersions(snapshots: Pick<BuilderSnapshot, 'source'>[]) {
  return snapshots.reduce((count, snapshot) => count + (snapshot.source.trim().length > 0 ? 1 : 0), 0);
}

export function getBuilderHistoryVersionState({
  committedSource,
  hasRejectedDefinition = false,
  hasRedoSnapshot,
  hasUndoSnapshot,
  historyVersionCount,
  redoVersionCount,
}: BuilderHistoryVersionStateInput): BuilderHistoryVersionState {
  const currentVersionNumber = committedSource.trim().length > 0 ? historyVersionCount : 0;
  const totalVersionCount = historyVersionCount + redoVersionCount;

  return {
    canRedo: hasRedoSnapshot,
    canReset: totalVersionCount > 0 || committedSource.trim().length > 0 || hasRejectedDefinition,
    canUndo: committedSource.trim().length > 0 && hasUndoSnapshot,
    currentVersionNumber,
    totalVersionCount,
    versionBadgeText: totalVersionCount > 0 ? `${currentVersionNumber} / ${totalVersionCount}` : '—',
  };
}

export function formatHistoryVersionChatMessage(action: 'redo' | 'undo', versionState: BuilderHistoryVersionState) {
  const versionLabel =
    versionState.totalVersionCount > 0 ? `${versionState.currentVersionNumber} / ${versionState.totalVersionCount}` : '—';

  return action === 'undo' ? `Reverted to version ${versionLabel}.` : `Restored version ${versionLabel}.`;
}
