import { useRef, type ChangeEvent, type MutableRefObject } from 'react';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { countCommittedVersions, getBuilderHistoryVersionState } from '@features/builder/historyVersionState';
import { createBuilderSnapshot, createResetDefinitionExport, parseImportedDefinition } from '@features/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import { createStandaloneHtml } from '@features/builder/standalone/createStandaloneHtml';
import { createStandalonePayload } from '@features/builder/standalone/createStandalonePayload';
import { downloadStandaloneHtml } from '@features/builder/standalone/downloadStandaloneHtml';
import {
  selectCommittedSource,
  selectHistory,
  selectIsStreaming,
  selectRedoHistory,
} from '@features/builder/store/selectors';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { resetAppState } from '@store/errorRecovery';

interface UseBuilderHistoryControlsOptions {
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onFeedbackChange: (message: string | null) => void;
}

function createDownloadFileName() {
  return `kitto-definition-${new Date().toISOString().replaceAll(':', '-')}.json`;
}

function createStandaloneDownloadFileName() {
  return `kitto-app-${new Date().toISOString().slice(0, 10)}.html`;
}

function getFeedbackMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export function useBuilderHistoryControls({
  cancelActiveRequestRef,
  onFeedbackChange,
}: UseBuilderHistoryControlsOptions) {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const committedSource = useAppSelector(selectCommittedSource);
  const history = useAppSelector(selectHistory);
  const redoHistory = useAppSelector(selectRedoHistory);
  const isStreaming = useAppSelector(selectIsStreaming);
  const previousSnapshot = history.at(-2);
  const redoSnapshot = redoHistory.at(-1);
  const historyVersionCount = countCommittedVersions(history);
  const redoVersionCount = countCommittedVersions(redoHistory);
  const historyVersionState = getBuilderHistoryVersionState({
    committedSource,
    hasRedoSnapshot: Boolean(redoSnapshot),
    hasUndoSnapshot: Boolean(previousSnapshot),
    historyVersionCount,
    isStreaming,
    redoVersionCount,
  });
  const isPristineCanvas = !committedSource.trim() && historyVersionState.totalVersionCount === 0;

  function handleExport() {
    if (isPristineCanvas) {
      return;
    }

    const definitionExport = createResetDefinitionExport(committedSource, history);
    const fileBlob = new Blob([JSON.stringify(definitionExport, null, 2)], {
      type: 'application/json',
    });
    const downloadUrl = URL.createObjectURL(fileBlob);
    const linkElement = document.createElement('a');
    linkElement.href = downloadUrl;
    linkElement.download = createDownloadFileName();
    linkElement.click();
    URL.revokeObjectURL(downloadUrl);
    onFeedbackChange('Definition exported.');
  }

  function handleDownloadStandalone() {
    if (!committedSource.trim()) {
      return;
    }

    const sourceValidation = validateOpenUiSource(committedSource);

    if (!sourceValidation.isValid) {
      dispatch(builderActions.setActiveTab('definition'));
      dispatch(builderActions.setParseIssues(sourceValidation.issues));
      onFeedbackChange('Standalone export failed: the committed OpenUI definition is invalid. Review the Definition tab.');
      return;
    }

    try {
      const payload = createStandalonePayload({
        committedSource,
        history,
      });
      const standaloneHtml = createStandaloneHtml(payload);

      downloadStandaloneHtml(standaloneHtml, createStandaloneDownloadFileName());
      onFeedbackChange('Standalone HTML downloaded.');
    } catch (error) {
      onFeedbackChange(`Standalone export failed: ${getFeedbackMessage(error)}`);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const rawValue = await file.text();
      const importedDefinition = parseImportedDefinition(rawValue);
      const sourceValidation = validateOpenUiSource(importedDefinition.source);

      if (!sourceValidation.isValid) {
        dispatch(
          builderActions.rejectDefinition({
            message: 'Imported definition is invalid.',
            source: importedDefinition.source,
            issues: sourceValidation.issues,
          }),
        );
        onFeedbackChange('Import failed: the OpenUI definition is invalid. Review the Definition tab for validation issues.');
        return;
      }

      const validHistory = importedDefinition.history.filter((snapshot) => validateOpenUiSource(snapshot.source).isValid);
      const importedHistory =
        validHistory.length > 0
          ? validHistory
          : [createBuilderSnapshot(importedDefinition.source, importedDefinition.runtimeState, importedDefinition.domainData)];

      resetAppState();
      dispatch(domainActions.replaceData(importedDefinition.domainData));
      dispatch(builderSessionActions.replaceRuntimeSessionState(importedDefinition.runtimeState));
      dispatch(
        builderActions.loadDefinition({
          source: importedDefinition.source,
          runtimeState: importedDefinition.runtimeState,
          history: importedHistory,
          note: 'Imported a saved Kitto definition from disk.',
        }),
      );
      onFeedbackChange(null);
    } catch (error) {
      onFeedbackChange(`Import failed: ${getFeedbackMessage(error)}`);
    } finally {
      event.target.value = '';
    }
  }

  function handleUndo() {
    if (!previousSnapshot || isStreaming) {
      return;
    }

    dispatch(domainActions.replaceData(previousSnapshot.domainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(previousSnapshot.runtimeState));
    dispatch(builderActions.undoLatest());
  }

  function handleRedo() {
    if (!redoSnapshot || isStreaming) {
      return;
    }

    dispatch(domainActions.replaceData(redoSnapshot.domainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(redoSnapshot.runtimeState));
    dispatch(builderActions.redoLatest());
  }

  function handleResetToEmpty() {
    if (!historyVersionState.canReset) {
      return;
    }

    cancelActiveRequestRef.current?.();
    onFeedbackChange(null);
    resetAppState();
    onFeedbackChange('Cleared the local app state and reset the builder.');
  }

  return {
    canExport: !isPristineCanvas,
    canDownloadStandalone: committedSource.trim().length > 0,
    canRedo: historyVersionState.canRedo,
    canReset: historyVersionState.canReset,
    canUndo: historyVersionState.canUndo,
    fileInputRef,
    handleDownloadStandalone,
    handleExport,
    handleImport,
    handleRedo,
    handleResetToEmpty,
    handleUndo,
    historyVersionLabel: historyVersionState.versionBadgeText,
  };
}
