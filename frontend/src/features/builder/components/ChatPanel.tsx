import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, Redo2, RotateCcw, Send, Undo2 } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Textarea } from '@components/ui/textarea';
import { streamBuilderDefinition } from '@features/builder/api/streamGenerate';
import { builderRequestLimits, validateBuilderLlmRequest } from '@features/builder/config';
import { createResetDefinitionExport, createBuilderSnapshot, parseImportedDefinition } from '@features/builder/openui/runtime/persistedState';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';
import { useHealthPolling } from '@features/builder/hooks/useHealthPolling';
import {
  selectChatMessages,
  selectCommittedSource,
  selectDomainData,
  selectDraftPrompt,
  selectHistory,
  selectIsStreaming,
  selectRedoHistory,
} from '@features/builder/store/selectors';
import { builderActions } from '@features/builder/store/builderSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import type { BuilderChatMessage, BuilderLlmRequest, BuilderParseIssue } from '@features/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { resetAppState } from '@store/errorRecovery';
import { useGenerateAppMutation } from '@api/apiSlice';

function getRequestErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'The request failed before the builder received a valid response.';
}

function getMessageBubbleClasses(message: BuilderChatMessage) {
  if (message.role === 'user') {
    return 'ml-auto border-slate-900 bg-slate-950 text-white';
  }

  if (message.tone === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }

  if (message.tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  return 'border-slate-200 bg-white text-slate-700';
}

function getFeedbackMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

function createDownloadFileName() {
  return `kitto-definition-${new Date().toISOString().replaceAll(':', '-')}.json`;
}

const MAX_AUTO_REPAIR_ATTEMPTS = 2;

function formatValidationIssue(issue: BuilderParseIssue) {
  return `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}: ${issue.message}`;
}

function buildRepairPrompt(userPrompt: string, issues: BuilderParseIssue[], attemptNumber: number) {
  return [
    `The previous OpenUI draft is invalid. Repair attempt ${attemptNumber}.`,
    `Original user request:\n${userPrompt}`,
    'Fix every validation issue below and return a complete corrected program.',
    ...issues.map((issue) => `- ${formatValidationIssue(issue)}`),
    'Important constraints:',
    '- Do not leave unresolved references.',
    '- Every @Run(statementId) must reference a defined Query or Mutation statement.',
    '- If a Mutation changes data that is rendered through a Query, call @Run(theQueryStatement) after the mutation so the preview refreshes immediately.',
    '- Preserve the intended UI and behavior unless a broken part must be rewritten to become valid.',
    '- Return only raw OpenUI Lang source.',
  ].join('\n');
}

function createValidationFailureMessage(issues: BuilderParseIssue[]) {
  const summary = issues.slice(0, 3).map(formatValidationIssue).join(' | ');
  return `The model kept returning invalid OpenUI after automatic repair. ${summary || 'Please try again.'}`;
}

export function ChatPanel() {
  const dispatch = useAppDispatch();
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatMessages = useAppSelector(selectChatMessages);
  const committedSource = useAppSelector(selectCommittedSource);
  const draftPrompt = useAppSelector(selectDraftPrompt);
  const history = useAppSelector(selectHistory);
  const redoHistory = useAppSelector(selectRedoHistory);
  const isStreaming = useAppSelector(selectIsStreaming);
  const domainData = useAppSelector(selectDomainData);
  const previousSnapshot = history.at(-2);
  const redoSnapshot = redoHistory.at(-1);
  const isEmptyCanvas = !committedSource.trim() && history.length === 1;
  const [generateApp, generateState] = useGenerateAppMutation();
  const [feedback, setFeedback] = useState<string | null>(null);
  const healthState = useHealthPolling();
  const isSubmitting = isStreaming || generateState.isLoading;
  const isBackendDisconnected = healthState.isError;

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages.length, feedback, isBackendDisconnected]);

  async function ensureValidGeneratedSource(initialSource: string, request: BuilderLlmRequest) {
    let candidateSource = initialSource;
    let attempt = 0;
    let hasAnnouncedRepair = false;

    while (attempt <= MAX_AUTO_REPAIR_ATTEMPTS) {
      const validation = validateOpenUiSource(candidateSource);

      if (validation.isValid) {
        return {
          note: hasAnnouncedRepair ? 'The first draft had parser issues, so it was repaired automatically before commit.' : undefined,
          source: candidateSource,
        };
      }

      if (!hasAnnouncedRepair) {
        dispatch(
          builderActions.appendChatMessage({
            role: 'system',
            tone: 'info',
            content: 'The model returned an invalid draft. Sending it back for automatic repair now.',
          }),
        );
        hasAnnouncedRepair = true;
      }

      attempt += 1;

      if (attempt > MAX_AUTO_REPAIR_ATTEMPTS) {
        throw new Error(createValidationFailureMessage(validation.issues));
      }

      const repairRequest: BuilderLlmRequest = {
        prompt: buildRepairPrompt(request.prompt, validation.issues, attempt),
        currentSource: candidateSource,
        chatHistory: request.chatHistory,
      };
      const repairRequestValidationError = validateBuilderLlmRequest(repairRequest);

      if (repairRequestValidationError) {
        throw new Error(repairRequestValidationError);
      }

      const repairedResponse = await generateApp(repairRequest).unwrap();

      candidateSource = repairedResponse.source;
    }

    return {
      source: candidateSource,
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = draftPrompt.trim();

    if (!nextPrompt || isSubmitting) {
      return;
    }

    const request: BuilderLlmRequest = {
      prompt: nextPrompt,
      currentSource: committedSource,
      chatHistory: chatMessages.map(({ content, role }) => ({ content, role })),
    };
    const requestValidationError = validateBuilderLlmRequest(request);

    if (requestValidationError) {
      setFeedback(requestValidationError);
      return;
    }

    let receivedChunk = false;
    setFeedback(null);
    dispatch(builderActions.beginStreaming({ prompt: nextPrompt }));

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const source = await streamBuilderDefinition({
        apiBaseUrl: getBackendApiBaseUrl(),
        request,
        signal: abortController.signal,
        onChunk: (chunk) => {
          receivedChunk = true;
          dispatch(builderActions.appendStreamChunk(chunk));
        },
      });

      const validatedResult = await ensureValidGeneratedSource(source, request);
      const snapshot = createBuilderSnapshot(validatedResult.source, {}, domainData);
      dispatch(
        builderActions.completeStreaming({
          source: validatedResult.source,
          note: validatedResult.note,
          snapshot,
        }),
      );
      abortControllerRef.current = null;
      return;
    } catch (error) {
      if (!receivedChunk) {
        try {
          const fallbackResponse = await generateApp(request).unwrap();
          const validatedResult = await ensureValidGeneratedSource(fallbackResponse.source, request);
          const snapshot = createBuilderSnapshot(validatedResult.source, {}, domainData);
          dispatch(
            builderActions.completeStreaming({
              source: validatedResult.source,
              note: validatedResult.note,
              snapshot,
            }),
          );
          abortControllerRef.current = null;
          return;
        } catch (fallbackError) {
          dispatch(
            builderActions.failStreaming({
              message: getRequestErrorMessage(fallbackError),
            }),
          );
          abortControllerRef.current = null;
          return;
        }
      }

      dispatch(
        builderActions.failStreaming({
          message: getRequestErrorMessage(error),
        }),
      );
      abortControllerRef.current = null;
    }
  }

  function handleExport() {
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
    setFeedback('Definition exported.');
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const rawValue = await file.text();
      const importedDefinition = parseImportedDefinition(rawValue);
      resetAppState();
      dispatch(domainActions.replaceData(importedDefinition.domainData));
      dispatch(
        builderActions.loadDefinition({
          source: importedDefinition.source,
          runtimeState: importedDefinition.runtimeState,
          history: importedDefinition.history,
          note: 'Imported a saved Kitto definition from disk.',
        }),
      );
      setFeedback('Definition imported.');
    } catch (error) {
      setFeedback(`Import failed: ${getFeedbackMessage(error)}`);
    } finally {
      event.target.value = '';
    }
  }

  function handleUndo() {
    if (!previousSnapshot || isSubmitting) {
      return;
    }

    dispatch(domainActions.replaceData(previousSnapshot.domainData));
    dispatch(builderActions.undoLatest());
  }

  function handleRedo() {
    if (!redoSnapshot || isSubmitting) {
      return;
    }

    dispatch(domainActions.replaceData(redoSnapshot.domainData));
    dispatch(builderActions.redoLatest());
  }

  function handleResetToEmpty() {
    if (isSubmitting || isEmptyCanvas) {
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setFeedback(null);
    resetAppState();
    setFeedback('Cleared the local app state and reset the builder.');
  }

  return (
    <Card className="flex h-full min-h-0 flex-col border-white/70 bg-white/92">
      <CardHeader className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 pb-4">
        <CardTitle className="shrink-0 text-2xl">Chat</CardTitle>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:justify-end">
          <Button className="h-7 rounded-lg border border-slate-200 px-2 text-xs shadow-none" size="sm" variant="secondary" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button
            className="h-7 rounded-lg border border-slate-200 px-2 text-xs shadow-none"
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="h-4 w-4" />
            Import
          </Button>
          <Button
            aria-label="Undo"
            className="h-7 w-7 rounded-lg border border-slate-200 px-0 shadow-none"
            disabled={!previousSnapshot || isSubmitting}
            size="sm"
            variant="ghost"
            onClick={handleUndo}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            aria-label="Redo"
            className="h-7 w-7 rounded-lg border border-slate-200 px-0 shadow-none"
            disabled={!redoSnapshot || isSubmitting}
            size="sm"
            variant="ghost"
            onClick={handleRedo}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            className="h-7 rounded-lg border border-slate-200 px-2 text-xs shadow-none"
            disabled={isSubmitting || isEmptyCanvas}
            size="sm"
            variant="ghost"
            onClick={handleResetToEmpty}
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <input ref={fileInputRef} accept="application/json" className="hidden" type="file" onChange={handleImport} />
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-3 pr-1">
            {isBackendDisconnected ? (
              <article className="max-w-full rounded-[1.4rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700 shadow-sm">
                Backend is disconnected. You can still inspect the last persisted definition, but new prompts will fail until
                <span className="font-semibold"> /api/health </span>
                recovers.
              </article>
            ) : null}

            {feedback ? (
              <article className="max-w-full rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600 shadow-sm">
                {feedback}
              </article>
            ) : null}

            {chatMessages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[92%] rounded-[1.4rem] border px-4 py-3 text-sm leading-6 shadow-sm ${getMessageBubbleClasses(message)}`}
              >
                <p>{message.content}</p>
              </article>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <form className="shrink-0 border-t border-slate-200/70 px-6 py-5" onSubmit={handleSubmit}>
          <Textarea
            className="min-h-[8rem] w-full text-[0.8rem] leading-5 shadow-none"
            maxLength={builderRequestLimits.promptMaxChars}
            placeholder="Describe the app or change you want."
            value={draftPrompt}
            onChange={(event) => dispatch(builderActions.setDraftPrompt(event.target.value))}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Press Cmd/Ctrl+Enter to send.</p>
            <Button disabled={!draftPrompt.trim() || isSubmitting} type="submit">
              <Send className="h-4 w-4" />
              {isSubmitting ? 'Generating...' : 'Send'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
