import { useRef, type ChangeEvent, type MutableRefObject } from 'react';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { createBuilderSnapshot, createResetDefinitionExport, parseImportedDefinition } from '@features/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import {
  selectCommittedSource,
  selectHistory,
  selectIsStreaming,
  selectRedoHistory,
} from '@features/builder/store/selectors';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { resetAppState } from '@store/errorRecovery';

interface UseBuilderHistoryControlsOptions {
  abortControllerRef: MutableRefObject<AbortController | null>;
  onFeedbackChange: (message: string | null) => void;
}

function createDownloadFileName() {
  return `kitto-definition-${new Date().toISOString().replaceAll(':', '-')}.json`;
}

function getFeedbackMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export function useBuilderHistoryControls({
  abortControllerRef,
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
  const isEmptyCanvas = !committedSource.trim() && history.length === 1;

  function handleExport() {
    if (isEmptyCanvas) {
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
            source: importedDefinition.source,
            issues: sourceValidation.issues,
          }),
        );
        onFeedbackChange('Import failed: the OpenUI definition is invalid. Review the Definition tab for validation issues.');
        return;
      }

      const importedHistory =
        importedDefinition.history.length > 0
          ? importedDefinition.history
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
    if (isStreaming || isEmptyCanvas) {
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    onFeedbackChange(null);
    resetAppState();
    onFeedbackChange('Cleared the local app state and reset the builder.');
  }

  return {
    canExport: !isEmptyCanvas,
    canRedo: Boolean(redoSnapshot) && !isStreaming,
    canReset: !isStreaming && !isEmptyCanvas,
    canUndo: Boolean(previousSnapshot) && !isStreaming,
    fileInputRef,
    handleExport,
    handleImport,
    handleRedo,
    handleResetToEmpty,
    handleUndo,
  };
}
