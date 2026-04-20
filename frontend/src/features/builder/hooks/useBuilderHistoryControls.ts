import { useRef, type ChangeEvent, type MutableRefObject } from 'react';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { countCommittedVersions, getBuilderHistoryVersionState } from '@features/builder/historyVersionState';
import {
  createBuilderSnapshot,
  createResetDefinitionExport,
  resolveImportedDefinition,
} from '@features/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import { createStandalonePayload } from '@features/builder/standalone/createStandalonePayload';
import { downloadStandaloneHtml } from '@features/builder/standalone/downloadStandaloneHtml';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@features/builder/store/chatMessageKeys';
import {
  selectCommittedSource,
  selectHasRejectedDefinition,
  selectHistory,
  selectIsStreaming,
  selectRedoHistory,
} from '@features/builder/store/selectors';
import type { BuilderChatNotice } from '@features/builder/types';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { resetAppState } from '@store/errorRecovery';

interface UseBuilderHistoryControlsOptions {
  cancelActiveRequestRef: MutableRefObject<(() => void) | null>;
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

type ExternalSnapshotChangeReason = 'import' | 'redo' | 'reset-to-empty' | 'undo';

let standaloneHtmlModulePromise: Promise<typeof import('@features/builder/standalone/createStandaloneHtml')> | null = null;

function createDownloadFileName() {
  return `kitto-definition-${new Date().toISOString().replaceAll(':', '-')}.json`;
}

function createStandaloneDownloadFileName() {
  return `kitto-app-${new Date().toISOString().replaceAll(':', '-')}.html`;
}

function createImportSuccessMessage(fileName: string) {
  return `Imported a saved Kitto definition from disk (${fileName}).`;
}

function createStandaloneDownloadSuccessMessage(fileName: string) {
  return `Standalone HTML downloaded (${fileName}).`;
}

function createDefinitionExportSuccessMessage(fileName: string) {
  return `Definition exported (${fileName}).`;
}

function getFeedbackMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

function loadStandaloneHtmlModule() {
  if (!standaloneHtmlModulePromise) {
    standaloneHtmlModulePromise = import('@features/builder/standalone/createStandaloneHtml').catch((error) => {
      standaloneHtmlModulePromise = null;
      throw error;
    });
  }

  return standaloneHtmlModulePromise;
}

function preloadStandaloneHtmlModule() {
  void loadStandaloneHtmlModule()
    .then(({ preloadStandalonePlayerAssets }) => preloadStandalonePlayerAssets())
    .catch(() => {
      // Ignore preload failures and fall back to the on-click path.
    });
}

export function useBuilderHistoryControls({
  cancelActiveRequestRef,
  onSystemNotice,
}: UseBuilderHistoryControlsOptions) {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const committedSource = useAppSelector(selectCommittedSource);
  const history = useAppSelector(selectHistory);
  const hasRejectedDefinition = useAppSelector(selectHasRejectedDefinition);
  const redoHistory = useAppSelector(selectRedoHistory);
  const isStreaming = useAppSelector(selectIsStreaming);
  const previousSnapshot = history.at(-2);
  const redoSnapshot = redoHistory.at(-1);
  const historyVersionCount = countCommittedVersions(history);
  const redoVersionCount = countCommittedVersions(redoHistory);
  const historyVersionState = getBuilderHistoryVersionState({
    committedSource,
    hasRejectedDefinition,
    hasRedoSnapshot: Boolean(redoSnapshot),
    hasUndoSnapshot: Boolean(previousSnapshot),
    historyVersionCount,
    isStreaming,
    redoVersionCount,
  });
  const isPristineCanvas = !committedSource.trim() && historyVersionState.totalVersionCount === 0;

  function appendSuccessChatMessage(content: string, messageKey?: string) {
    onSystemNotice(null);
    dispatch(
      builderActions.appendChatMessage({
        content,
        messageKey,
        role: 'system',
        tone: 'success',
      }),
    );
  }

  function appendErrorChatMessage(content: string) {
    onSystemNotice(null);
    dispatch(
      builderActions.appendChatMessage({
        content,
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionImportStatus,
        role: 'system',
        tone: 'error',
      }),
    );
  }

  function abortActiveGenerationIfAny(reason: ExternalSnapshotChangeReason) {
    void reason;
    cancelActiveRequestRef.current?.();
  }

  function handleExport() {
    if (isPristineCanvas) {
      return;
    }

    const definitionExport = createResetDefinitionExport(committedSource, history);
    const fileBlob = new Blob([JSON.stringify(definitionExport, null, 2)], {
      type: 'application/json',
    });
    const downloadFileName = createDownloadFileName();
    const downloadUrl = URL.createObjectURL(fileBlob);
    const linkElement = document.createElement('a');
    linkElement.href = downloadUrl;
    linkElement.download = downloadFileName;
    linkElement.click();
    URL.revokeObjectURL(downloadUrl);
    appendSuccessChatMessage(
      createDefinitionExportSuccessMessage(downloadFileName),
      SYSTEM_CHAT_MESSAGE_KEYS.definitionExportSuccess,
    );
  }

  async function handleDownloadStandalone() {
    if (!committedSource.trim()) {
      return;
    }

    const sourceValidation = validateOpenUiSource(committedSource);

    if (!sourceValidation.isValid) {
      dispatch(builderActions.setActiveTab('definition'));
      dispatch(builderActions.setParseIssues(sourceValidation.issues));
      onSystemNotice({
        content: 'Standalone export failed: the committed OpenUI definition is invalid. Review the Definition tab.',
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.standaloneHtmlDownloadStatus,
        tone: 'error',
      });
      return;
    }

    try {
      // Load the standalone HTML generator and inline player assets only when the user exports.
      const { createStandaloneHtml } = await loadStandaloneHtmlModule();
      const payload = createStandalonePayload({
        committedSource,
        history,
      });
      const standaloneHtml = await createStandaloneHtml(payload);
      const downloadFileName = createStandaloneDownloadFileName();

      downloadStandaloneHtml(standaloneHtml, downloadFileName);
      appendSuccessChatMessage(
        createStandaloneDownloadSuccessMessage(downloadFileName),
        SYSTEM_CHAT_MESSAGE_KEYS.standaloneHtmlDownloadStatus,
      );
    } catch (error) {
      onSystemNotice({
        content: `Standalone export failed: ${getFeedbackMessage(error)}`,
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.standaloneHtmlDownloadStatus,
        tone: 'error',
      });
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    abortActiveGenerationIfAny('import');

    try {
      const rawValue = await file.text();
      const importedDefinitionResult = resolveImportedDefinition(rawValue);

      if (importedDefinitionResult.kind === 'invalid-source') {
        const { definition, issues } = importedDefinitionResult;
        dispatch(
          builderActions.rejectDefinition({
            message: 'Imported definition is invalid.',
            source: definition.source,
            issues,
          }),
        );
        appendErrorChatMessage('Import failed: the OpenUI definition is invalid. Review the Definition tab for validation issues.');
        return;
      }

      const importedDefinition = importedDefinitionResult.definition;
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
          messageKey: SYSTEM_CHAT_MESSAGE_KEYS.definitionImportStatus,
          note: createImportSuccessMessage(file.name),
        }),
      );
      onSystemNotice(null);
    } catch (error) {
      appendErrorChatMessage(`Import failed: ${getFeedbackMessage(error)}`);
    } finally {
      event.target.value = '';
    }
  }

  function handleUndo() {
    if (!previousSnapshot) {
      return;
    }

    abortActiveGenerationIfAny('undo');
    dispatch(domainActions.replaceData(previousSnapshot.domainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(previousSnapshot.runtimeState));
    dispatch(builderActions.undoLatest());
  }

  function handleRedo() {
    if (!redoSnapshot) {
      return;
    }

    abortActiveGenerationIfAny('redo');
    dispatch(domainActions.replaceData(redoSnapshot.domainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(redoSnapshot.runtimeState));
    dispatch(builderActions.redoLatest());
  }

  function handleResetToEmpty() {
    if (!historyVersionState.canReset) {
      return;
    }

    abortActiveGenerationIfAny('reset-to-empty');
    onSystemNotice(null);
    resetAppState();
    onSystemNotice({
      content: 'Cleared the local app state and reset the builder.',
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.builderResetStatus,
      tone: 'info',
    });
  }

  return {
    canExport: !isPristineCanvas,
    canDownloadStandalone: committedSource.trim().length > 0,
    canRedo: historyVersionState.canRedo,
    canReset: historyVersionState.canReset,
    canUndo: historyVersionState.canUndo,
    fileInputRef,
    preloadStandaloneHtml: preloadStandaloneHtmlModule,
    handleDownloadStandalone,
    handleExport,
    handleImport,
    handleRedo,
    handleResetToEmpty,
    handleUndo,
    historyVersionLabel: historyVersionState.versionBadgeText,
  };
}
