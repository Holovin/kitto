import { useEffect, useRef, type ChangeEvent } from 'react';
import { useBuilderRequestControls } from '@pages/Chat/builder/context/builderRequestControls';
import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import { builderSessionActions } from '@pages/Chat/builder/store/builderSessionSlice';
import { domainActions } from '@pages/Chat/builder/store/domainSlice';
import { countCommittedVersions, getBuilderHistoryVersionState } from '@pages/Chat/builder/historyVersionState';
import {
  createBuilderSnapshot,
  createResetDefinitionExport,
  resolveImportedDefinition,
} from '@pages/Chat/builder/openui/runtime/persistedState';
import {
  recoverStaleNavigationDomainData,
  recoverStaleNavigationSnapshot,
} from '@pages/Chat/builder/openui/runtime/navigationRecovery';
import { validateOpenUiSource } from '@pages/Chat/builder/openui/runtime/validation';
import { createStandalonePayload } from '@pages/Chat/builder/standalone/createStandalonePayload';
import { downloadStandaloneHtml } from '@pages/Chat/builder/standalone/downloadStandaloneHtml';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@pages/Chat/builder/store/chatMessageKeys';
import {
  selectCommittedSource,
  selectHasChatMessages,
  selectHasRejectedDefinition,
  selectHistory,
  selectIsStreaming,
  selectRedoHistory,
} from '@pages/Chat/builder/store/selectors';
import type { BuilderChatNotice } from '@pages/Chat/builder/types';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { resetAppStateWithDispatch } from '@store/resetAppState';

interface UseBuilderHistoryControlsOptions {
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

let standaloneHtmlModulePromise: Promise<typeof import('@pages/Chat/builder/standalone/createStandaloneHtml')> | null = null;

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
    standaloneHtmlModulePromise = import('@pages/Chat/builder/standalone/createStandaloneHtml').catch((error) => {
      standaloneHtmlModulePromise = null;
      throw error;
    });
  }

  return standaloneHtmlModulePromise;
}

function preloadStandaloneHtmlModule() {
  loadStandaloneHtmlModule()
    .then(({ preloadStandalonePlayerAssets }) => preloadStandalonePlayerAssets())
    .catch(() => {
      // Ignore preload failures and fall back to the on-click path.
    });
}

export function useBuilderHistoryControls({ onSystemNotice }: UseBuilderHistoryControlsOptions) {
  const dispatch = useAppDispatch();
  const { cancelActiveRequest } = useBuilderRequestControls();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasChatMessages = useAppSelector(selectHasChatMessages);
  const committedSource = useAppSelector(selectCommittedSource);
  const history = useAppSelector(selectHistory);
  const hasRejectedDefinition = useAppSelector(selectHasRejectedDefinition);
  const isStreaming = useAppSelector(selectIsStreaming);
  const redoHistory = useAppSelector(selectRedoHistory);
  const isStreamingRef = useRef(isStreaming);
  const previousSnapshot = history.at(-2);
  const redoSnapshot = redoHistory.at(-1);
  const historyVersionCount = countCommittedVersions(history);
  const redoVersionCount = countCommittedVersions(redoHistory);
  const historyVersionState = getBuilderHistoryVersionState({
    committedSource,
    hasChatMessages,
    hasRejectedDefinition,
    hasRedoSnapshot: Boolean(redoSnapshot),
    hasUndoSnapshot: Boolean(previousSnapshot),
    historyVersionCount,
    redoVersionCount,
  });
  const isPristineCanvas = !committedSource.trim() && historyVersionState.totalVersionCount === 0;

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

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

    cancelActiveRequest();
    onSystemNotice(null);
    resetAppStateWithDispatch(dispatch);

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
          : [
              createBuilderSnapshot(importedDefinition.source, importedDefinition.runtimeState, importedDefinition.domainData, {
                appMemory: importedDefinition.appMemory,
              }),
            ];
      const recoveredDomainData = recoverStaleNavigationDomainData(importedDefinition.source, importedDefinition.domainData);
      const recoveredImportedHistory = importedHistory.map((snapshot) => recoverStaleNavigationSnapshot(snapshot));

      dispatch(domainActions.replaceData(recoveredDomainData.domainData));
      dispatch(builderSessionActions.replaceRuntimeSessionState(importedDefinition.runtimeState));
      dispatch(
        builderActions.loadDefinition({
          source: importedDefinition.source,
          appMemory: importedDefinition.appMemory,
          runtimeState: importedDefinition.runtimeState,
          history: recoveredImportedHistory,
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
    if (isStreamingRef.current || !previousSnapshot) {
      return;
    }

    onSystemNotice(null);
    const recoveredSnapshot = recoverStaleNavigationSnapshot(previousSnapshot);

    dispatch(domainActions.replaceData(recoveredSnapshot.domainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(recoveredSnapshot.runtimeState));
    dispatch(builderActions.undoLatest());
  }

  function handleRedo() {
    if (isStreamingRef.current || !redoSnapshot) {
      return;
    }

    onSystemNotice(null);
    const recoveredSnapshot = recoverStaleNavigationSnapshot(redoSnapshot);

    dispatch(domainActions.replaceData(recoveredSnapshot.domainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(recoveredSnapshot.runtimeState));
    dispatch(builderActions.redoLatest());
  }

  function handleResetToEmpty() {
    if (isStreamingRef.current || !historyVersionState.canReset) {
      return;
    }

    onSystemNotice(null);
    resetAppStateWithDispatch(dispatch);
    onSystemNotice({
      content: 'Cleared the local app state and reset the builder.',
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.builderResetStatus,
      tone: 'info',
    });
  }

  return {
    canExport: !isPristineCanvas,
    canDownloadStandalone: committedSource.trim().length > 0,
    canRedo: !isStreaming && historyVersionState.canRedo,
    canReset: !isStreaming && historyVersionState.canReset,
    canUndo: !isStreaming && historyVersionState.canUndo,
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
