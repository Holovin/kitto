import { useEffect, useMemo, useRef, useState } from 'react';
import type { Spec } from '@json-render/core';
import { useHealthQuery, useRuntimeConfigQuery } from '@api/apiSlice';
import { getApiUrl } from '@helpers/environment';
import { ChatPanel } from '@features/builder/components/ChatPanel';
import { PreviewTabs } from '@features/builder/components/PreviewTabs';
import { useSpecStream } from '@features/builder/api/useSpecStream';
import {
  appendMessage,
  enqueueSnapshot,
  failGeneration,
  finishGeneration,
  reapplySnapshot,
  resetBuilderState,
  restoreSnapshot,
  setBuilderSpec,
  startGeneration,
} from '@features/builder/store/builderSlice';
import { replaceRuntimeState, resetRuntimeState } from '@features/builder/store/runtimeSlice';
import {
  buildExportPayload,
  cloneRuntimeState,
  cloneSpec,
  createSnapshot,
  getDefinitionValidation,
  getBuilderDemoPreset,
  mergeRuntimeStateWithSpec,
  parseImportedDefinition,
  type BuilderRuntimeState,
} from '@features/builder/utils/state';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { BUILDER_RESET_SLICE_KEYS, clearRememberedSlices } from '@store/store';
import type { RequestCompactionNotice } from '@features/builder/api/contracts';

const previewDemoActions = [
  { id: 'todo-create', label: 'Create a todo list', presetId: 'todo' },
  { id: 'todo-due-dates', label: 'Add due dates', presetId: 'todo' },
  { id: 'todo-filter', label: 'Allow filtering by completed', presetId: 'todo' },
  { id: 'quiz-create', label: 'Create a quiz with 3 questions', presetId: 'quiz' },
  { id: 'quiz-result', label: 'Show result screen after the last question', presetId: 'quiz' },
  { id: 'agreement-step', label: 'Add a checkbox agreement step before submit', presetId: 'agreement' },
] as const;
const MAX_STREAM_REPAIR_ATTEMPTS = 1;
const RECOVERABLE_STREAM_ERROR_PATTERNS = [/read only property/i, /\bpatch\b/i, /\bjson\b/i, /\bspec\b/i, /\bschema\b/i, /\bvalidation\b/i, /\bunexpected\b/i];
const NON_RECOVERABLE_STREAM_ERROR_PATTERNS = [/http error/i, /failed to fetch/i, /openai_api_key/i, /\b503\b/i, /\bnetwork\b/i];

type StreamConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type PendingGenerationRequest = {
  prompt: string;
  messages: StreamConversationMessage[];
  previousSpec: Spec | null;
  runtimeState: BuilderRuntimeState;
  repairAttempt: number;
};

function isRecoverableStreamError(streamError: Error, rawLines: string[]) {
  if (NON_RECOVERABLE_STREAM_ERROR_PATTERNS.some((pattern) => pattern.test(streamError.message))) {
    return false;
  }

  if (rawLines.length > 0) {
    return true;
  }

  return RECOVERABLE_STREAM_ERROR_PATTERNS.some((pattern) => pattern.test(streamError.message));
}

function createStreamErrorKey(streamError: Error, rawLinesCount: number, repairAttempt: number) {
  return `${repairAttempt}:${rawLinesCount}:${streamError.message}`;
}

function formatRequestCompactionNotice(notice: RequestCompactionNotice | null) {
  if (!notice) {
    return null;
  }

  const parts: string[] = [];

  if (notice.droppedRawLines) {
    parts.push('removed repair debug lines');
  }

  if (notice.droppedMessages > 0) {
    parts.push(`dropped ${notice.droppedMessages} older chat message${notice.droppedMessages === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) {
    parts.push('compacted the request');
  }

  const sizeLabel = notice.requestBytes ? ` Final request size: ${notice.requestBytes} bytes.` : '';
  return `Backend compacted this request before sending it to OpenAI: ${parts.join(' and ')}.${sizeLabel}`;
}

export default function ChatPage() {
  const dispatch = useAppDispatch();
  const builderState = useAppSelector((state) => state.builder);
  const runtimeState = useAppSelector((state) => state.runtime);
  const [prompt, setPrompt] = useState('');
  const [panelError, setPanelError] = useState<string | null>(null);
  const activeRequestRef = useRef<PendingGenerationRequest | null>(null);
  const handledStreamErrorRef = useRef<string | null>(null);
  const { data: runtimeConfig } = useRuntimeConfigQuery();
  const { data: healthData, error: healthError, isLoading: healthLoading, isFetching: healthFetching } = useHealthQuery(undefined, {
    pollingInterval: 30_000,
  });
  const builderHistory = Array.isArray(builderState.history) ? builderState.history : [];
  const builderFuture = Array.isArray(builderState.future) ? builderState.future : [];
  const builderMessages = Array.isArray(builderState.messages) ? builderState.messages : [];
  const builderLastPrompt = typeof builderState.lastPrompt === 'string' ? builderState.lastPrompt : '';

  const { spec: streamedSpec, isStreaming, error, rawLines, send, requestCompactionNotice } = useSpecStream({
    api: getApiUrl('/llm/generate/stream'),
    onComplete: (nextSpec) => {
      const completedRequest = activeRequestRef.current;
      activeRequestRef.current = null;
      handledStreamErrorRef.current = null;
      setPanelError(null);
      const mergedRuntimeState = mergeRuntimeStateWithSpec(nextSpec, completedRequest?.runtimeState ?? runtimeState);

      dispatch(setBuilderSpec(nextSpec));
      dispatch(replaceRuntimeState(mergedRuntimeState));
      dispatch(finishGeneration());
      dispatch(
        appendMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Preview updated. Open the Definition tab to inspect the current JSON spec.',
          createdAt: new Date().toISOString(),
        }),
      );
    },
  });

  const streamVisibleSpec = streamedSpec && streamedSpec.root ? streamedSpec : null;
  const activeSpec = (isStreaming ? streamVisibleSpec : builderState.spec) as Spec | null;
  const definitionState = useMemo(() => getDefinitionValidation(activeSpec), [activeSpec]);
  const canUndo = builderHistory.length > 0 && !isStreaming;
  const canRedo = builderFuture.length > 0 && !isStreaming;
  const isBackendDisconnected = !healthLoading && !healthFetching && !healthData && Boolean(healthError);
  const requestError = builderState.request.error ?? error?.message ?? null;
  const promptMaxChars = runtimeConfig?.limits.promptMaxChars ?? null;
  const chatHistoryMaxItems = runtimeConfig?.limits.chatHistoryMaxItems ?? Number.POSITIVE_INFINITY;
  const requestNotice = useMemo(() => formatRequestCompactionNotice(requestCompactionNotice), [requestCompactionNotice]);

  useEffect(() => {
    if (!error || isStreaming) {
      return;
    }

    const currentRequest = activeRequestRef.current;
    const errorKey = createStreamErrorKey(error, rawLines.length, currentRequest?.repairAttempt ?? 0);

    if (handledStreamErrorRef.current === errorKey) {
      return;
    }

    handledStreamErrorRef.current = errorKey;

    if (currentRequest && isRecoverableStreamError(error, rawLines) && currentRequest.repairAttempt < MAX_STREAM_REPAIR_ATTEMPTS) {
      const repairAttempt = currentRequest.repairAttempt + 1;
      const repairRequest: PendingGenerationRequest = {
        ...currentRequest,
        repairAttempt,
      };

      activeRequestRef.current = repairRequest;
      dispatch(
        appendMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: 'Model returned an invalid patch stream. Continuing automatically with a repair request.',
          createdAt: new Date().toISOString(),
        }),
      );
      dispatch(startGeneration({ prompt: repairRequest.prompt }));
      void send({
        prompt: repairRequest.prompt,
        currentSpec: cloneSpec(repairRequest.previousSpec),
        messages: repairRequest.messages,
        runtimeState: cloneRuntimeState(repairRequest.runtimeState),
        repairContext: {
          attempt: repairAttempt,
          error: error.message,
          rawLines: rawLines.slice(-40),
        },
      });
      return;
    }

    activeRequestRef.current = null;
    dispatch(failGeneration(error.message));
    dispatch(
      appendMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Generation failed: ${error.message}`,
        createdAt: new Date().toISOString(),
      }),
    );
  }, [dispatch, error, isStreaming, rawLines, send]);

  async function handleSend() {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isStreaming) {
      return;
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: trimmedPrompt,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...builderMessages, userMessage];

    dispatch(appendMessage(userMessage));
    dispatch(enqueueSnapshot(createSnapshot(builderState.spec, runtimeState, trimmedPrompt)));
    dispatch(startGeneration({ prompt: trimmedPrompt }));
    setPanelError(null);
    setPrompt('');
    handledStreamErrorRef.current = null;

    const streamMessages = nextMessages
      .filter((message) => message.role !== 'system')
      .slice(-chatHistoryMaxItems)
      .map((message) => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
      })) as StreamConversationMessage[];
    const request: PendingGenerationRequest = {
      prompt: trimmedPrompt,
      messages: streamMessages,
      previousSpec: cloneSpec(builderState.spec),
      runtimeState: cloneRuntimeState(runtimeState),
      repairAttempt: 0,
    };
    activeRequestRef.current = request;

    await send({
      prompt: trimmedPrompt,
      currentSpec: cloneSpec(request.previousSpec),
      messages: request.messages,
      runtimeState: cloneRuntimeState(request.runtimeState),
    });
  }

  function handleUndo() {
    const lastSnapshot = builderHistory.at(-1);

    if (!lastSnapshot) {
      return;
    }

    dispatch(
      restoreSnapshot({
        target: lastSnapshot,
        current: createSnapshot(builderState.spec, runtimeState, builderLastPrompt),
      }),
    );
    dispatch(replaceRuntimeState(lastSnapshot.runtimeState));
    setPanelError(null);
  }

  function handleRedo() {
    const nextSnapshot = builderFuture.at(-1);

    if (!nextSnapshot) {
      return;
    }

    dispatch(
      reapplySnapshot({
        target: nextSnapshot,
        current: createSnapshot(builderState.spec, runtimeState, builderLastPrompt),
      }),
    );
    dispatch(replaceRuntimeState(nextSnapshot.runtimeState));
    setPanelError(null);
  }

  function handleResetEmpty() {
    activeRequestRef.current = null;
    handledStreamErrorRef.current = null;
    dispatch(resetBuilderState());
    dispatch(resetRuntimeState());
    clearRememberedSlices(BUILDER_RESET_SLICE_KEYS);
    setPanelError(null);
    setPrompt('');
  }

  function handleLoadDemo(presetId: string) {
    const preset = getBuilderDemoPreset(presetId);

    if (!preset) {
      return;
    }

    const nextPreset = preset.build();

    dispatch(enqueueSnapshot(createSnapshot(builderState.spec, runtimeState, `Load demo: ${preset.title}`)));
    dispatch(setBuilderSpec(nextPreset.spec));
    dispatch(replaceRuntimeState(nextPreset.runtimeState));
    setPanelError(null);
    dispatch(
      appendMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: preset.loadMessage,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  async function handleCopyDefinition() {
    try {
      await navigator.clipboard.writeText(definitionState.prettyJson || '');
      setPanelError(null);
    } catch (copyError) {
      const message = copyError instanceof Error ? copyError.message : 'Failed to copy the current definition.';
      setPanelError(message);
    }
  }

  function handleExportDefinition() {
    if (!activeSpec) {
      return;
    }

    try {
      const payload = buildExportPayload(activeSpec, runtimeState);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `kitto-definition-${Date.now()}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setPanelError(null);
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : 'Failed to export the current definition.';
      setPanelError(message);
    }
  }

  function handleImportDefinition(contents: string) {
    try {
      const imported = parseImportedDefinition(contents);

      dispatch(enqueueSnapshot(createSnapshot(builderState.spec, runtimeState, 'Import definition')));
      dispatch(setBuilderSpec(imported.spec));
      dispatch(replaceRuntimeState(imported.runtimeState));
      setPanelError(null);
      dispatch(
        appendMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Definition imported into the preview.',
          createdAt: new Date().toISOString(),
        }),
      );
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : 'Failed to import the provided definition.';
      setPanelError(message);
    }
  }

  return (
    <section className="grid h-full min-h-0 w-full flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 overflow-hidden xl:grid-cols-[minmax(22rem,32rem)_minmax(0,1fr)] xl:grid-rows-1">
      <ChatPanel
        messages={builderMessages}
        prompt={prompt}
        promptLength={prompt.length}
        promptMaxChars={promptMaxChars}
        onPromptChange={setPrompt}
        onSend={() => void handleSend()}
        onExport={handleExportDefinition}
        onImport={handleImportDefinition}
        onAuxError={setPanelError}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onResetEmpty={handleResetEmpty}
        canUndo={canUndo}
        canRedo={canRedo}
        isStreaming={isStreaming}
        requestError={requestError}
        requestNotice={requestNotice}
        backendDisconnected={isBackendDisconnected}
      />

      <PreviewTabs
        spec={activeSpec}
        isStreaming={isStreaming}
        definitionJson={definitionState.prettyJson}
        structuralIssues={definitionState.structuralIssues}
        catalogIssues={definitionState.catalogIssues}
        onCopy={handleCopyDefinition}
        onResetEmpty={handleResetEmpty}
        onLoadDemo={handleLoadDemo}
        demoActions={previewDemoActions}
        panelError={panelError}
        onDismissPanelError={() => setPanelError(null)}
      />
    </section>
  );
}
