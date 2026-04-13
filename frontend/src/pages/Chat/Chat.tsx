import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Spec } from '@json-render/core';
import { useRuntimeConfigQuery } from '@api/apiSlice';
import { getApiUrl } from '@helpers/environment';
import { ChatPanel } from '@features/builder/components/ChatPanel';
import { PreviewTabs } from '@features/builder/components/PreviewTabs';
import { generateOnce, useSpecStream } from '@features/builder/api/useSpecStream';
import { useBackendStatus } from '@features/system/useBackendStatus';
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
import type { GenerateRequest, RequestCompactionNotice } from '@features/builder/api/contracts';

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
  payload: GenerateRequest;
  runtimeState: BuilderRuntimeState;
  repairAttempt: number;
};

function cloneGenerateRequest(request: GenerateRequest): GenerateRequest {
  return {
    ...request,
    currentSpec: cloneSpec(request.currentSpec ?? null),
    messages: request.messages?.map((message) => ({ ...message })),
    runtimeState: request.runtimeState ? cloneRuntimeState(request.runtimeState) : null,
    repairContext: request.repairContext
      ? {
          ...request.repairContext,
          rawLines: request.repairContext.rawLines ? [...request.repairContext.rawLines] : undefined,
        }
      : undefined,
  };
}

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
  const [isFallbackGenerating, setIsFallbackGenerating] = useState(false);
  const [fallbackRequestCompactionNotice, setFallbackRequestCompactionNotice] = useState<RequestCompactionNotice | null>(null);
  const activeRequestRef = useRef<PendingGenerationRequest | null>(null);
  const handledStreamErrorRef = useRef<string | null>(null);
  const fallbackAbortControllerRef = useRef<AbortController | null>(null);
  const { data: runtimeConfig } = useRuntimeConfigQuery();
  const { status: backendStatus } = useBackendStatus();
  const builderHistory = Array.isArray(builderState.history) ? builderState.history : [];
  const builderFuture = Array.isArray(builderState.future) ? builderState.future : [];
  const builderMessages = Array.isArray(builderState.messages) ? builderState.messages : [];
  const builderLastPrompt = typeof builderState.lastPrompt === 'string' ? builderState.lastPrompt : '';
  const streamApi = getApiUrl('/llm/generate/stream');
  const generateApi = getApiUrl('/llm/generate');

  const applyGeneratedSpec = useCallback(
    (nextSpec: Spec, completedRequest: PendingGenerationRequest | null) => {
      activeRequestRef.current = null;
      handledStreamErrorRef.current = null;
      setIsFallbackGenerating(false);
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
    [dispatch, runtimeState],
  );

  const failGenerationRequest = useCallback(
    (message: string) => {
      activeRequestRef.current = null;
      handledStreamErrorRef.current = null;
      setIsFallbackGenerating(false);
      dispatch(failGeneration(message));
      dispatch(
        appendMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Generation failed: ${message}`,
          createdAt: new Date().toISOString(),
        }),
      );
    },
    [dispatch],
  );

  const { spec: streamedSpec, isStreaming, error, rawLines, send, clear, requestCompactionNotice } = useSpecStream({
    api: streamApi,
    onComplete: (nextSpec) => {
      const completedRequest = activeRequestRef.current;
      applyGeneratedSpec(nextSpec, completedRequest);
    },
  });

  useEffect(() => {
    return () => {
      fallbackAbortControllerRef.current?.abort();
    };
  }, []);

  const startFallbackGeneration = useCallback(
    async (request: PendingGenerationRequest, streamError: Error) => {
      fallbackAbortControllerRef.current?.abort();
      const controller = new AbortController();

      fallbackAbortControllerRef.current = controller;
      setIsFallbackGenerating(true);

      try {
        const { result, requestCompactionNotice: fallbackNotice } = await generateOnce(
          generateApi,
          cloneGenerateRequest(request.payload),
          controller.signal,
        );

        if (fallbackAbortControllerRef.current !== controller) {
          return;
        }

        if (fallbackNotice) {
          setFallbackRequestCompactionNotice(fallbackNotice);
        }

        applyGeneratedSpec(result.spec, request);
      } catch (fallbackError) {
        if (fallbackError instanceof DOMException && fallbackError.name === 'AbortError') {
          return;
        }

        const nextError = fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
        const finalMessage =
          nextError.message === streamError.message
            ? nextError.message
            : `Stream request failed: ${streamError.message}. Fallback request failed: ${nextError.message}`;

        failGenerationRequest(finalMessage);
      } finally {
        if (fallbackAbortControllerRef.current === controller) {
          fallbackAbortControllerRef.current = null;
          setIsFallbackGenerating(false);
        }
      }
    },
    [applyGeneratedSpec, failGenerationRequest, generateApi],
  );

  const isGenerating = isStreaming || isFallbackGenerating;
  const streamVisibleSpec = streamedSpec && streamedSpec.root ? streamedSpec : null;
  const activeSpec = (isGenerating ? streamVisibleSpec ?? builderState.spec : builderState.spec) as Spec | null;
  const definitionState = useMemo(() => getDefinitionValidation(activeSpec), [activeSpec]);
  const canUndo = builderHistory.length > 0 && !isGenerating;
  const canRedo = builderFuture.length > 0 && !isGenerating;
  const requestError = builderState.request.error ?? null;
  const promptMaxChars = runtimeConfig?.limits.promptMaxChars ?? null;
  const chatHistoryMaxItems = runtimeConfig?.limits.chatHistoryMaxItems ?? Number.POSITIVE_INFINITY;
  const requestNotice = useMemo(
    () => formatRequestCompactionNotice(fallbackRequestCompactionNotice ?? requestCompactionNotice),
    [fallbackRequestCompactionNotice, requestCompactionNotice],
  );

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
      const repairPayload: GenerateRequest = {
        ...cloneGenerateRequest(currentRequest.payload),
        repairContext: {
          attempt: repairAttempt,
          error: error.message,
          rawLines: rawLines.slice(-40),
        },
      };
      const repairRequest: PendingGenerationRequest = {
        ...currentRequest,
        payload: repairPayload,
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
      void send(cloneGenerateRequest(repairRequest.payload));
      return;
    }

    if (!currentRequest) {
      failGenerationRequest(error.message);
      return;
    }

    void startFallbackGeneration(currentRequest, error);
  }, [dispatch, error, failGenerationRequest, isStreaming, rawLines, send, startFallbackGeneration]);

  async function handleSend() {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isGenerating) {
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
    setFallbackRequestCompactionNotice(null);
    handledStreamErrorRef.current = null;
    fallbackAbortControllerRef.current?.abort();

    const streamMessages = nextMessages
      .filter((message) => message.role !== 'system')
      .slice(-chatHistoryMaxItems)
      .map((message) => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
      })) as StreamConversationMessage[];
    const previousSpec = cloneSpec(builderState.spec);
    const nextRuntimeState = cloneRuntimeState(runtimeState);
    const payload: GenerateRequest = {
      prompt: trimmedPrompt,
      currentSpec: cloneSpec(previousSpec),
      messages: streamMessages,
      runtimeState: cloneRuntimeState(nextRuntimeState),
    };
    const request: PendingGenerationRequest = {
      prompt: trimmedPrompt,
      payload,
      runtimeState: nextRuntimeState,
      repairAttempt: 0,
    };
    activeRequestRef.current = request;

    await send(cloneGenerateRequest(request.payload));
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
    fallbackAbortControllerRef.current?.abort();
    activeRequestRef.current = null;
    handledStreamErrorRef.current = null;
    setIsFallbackGenerating(false);
    setFallbackRequestCompactionNotice(null);
    clear();
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
        isStreaming={isGenerating}
        requestError={requestError}
        requestNotice={requestNotice}
        backendStatus={backendStatus}
      />

      <PreviewTabs
        spec={activeSpec}
        isStreaming={isGenerating}
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
