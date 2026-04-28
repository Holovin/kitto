import { useEffect, useRef, type FormEvent } from 'react';
import { useConfigQuery } from '@api/apiSlice';
import {
  getBuilderMaxRepairAttempts,
  getBuilderMaxRepairValidationIssues,
  getBuilderRequestLimits,
  getBuilderSanitizedLlmRequestForTransport,
  getBuilderRuntimeConfigStatus,
  getBuilderStreamTimeouts,
  validateBuilderLlmRequest,
} from '@pages/Chat/builder/config';
import { useGenerationLifecycle } from './useGenerationLifecycle';
import { useStreamingSummary } from './useStreamingSummary';
import { useValidationRepair } from './useValidationRepair';
import { runBuilderGeneration } from './builderGenerationService';
import { resolveBuilderComposerPrompt } from './submissionPrompt';
import { resolveRuntimeConfigNotice } from '@pages/Chat/builder/components/chatNotices';
import {
  selectChatMessages,
  selectAppMemory,
  selectCommittedSource,
  selectDomainData,
  selectDraftPrompt,
  selectPreviousCommittedSource,
  selectRetryPrompt,
} from '@pages/Chat/builder/store/selectors';
import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import type {
  BuilderChatNotice,
  PromptBuildRequest,
} from '@pages/Chat/builder/types';
import { getBackendApiBaseUrl } from '@helpers/environment';
import { useAppDispatch, useAppSelector } from '@store/hooks';

interface UseBuilderSubmissionOptions {
  onSystemNotice: (notice: BuilderChatNotice | null) => void;
}

export function useBuilderSubmission({ onSystemNotice }: UseBuilderSubmissionOptions) {
  const dispatch = useAppDispatch();
  const chatMessages = useAppSelector(selectChatMessages);
  const appMemory = useAppSelector(selectAppMemory);
  const committedSource = useAppSelector(selectCommittedSource);
  const previousSource = useAppSelector(selectPreviousCommittedSource);
  const domainData = useAppSelector(selectDomainData);
  const draftPrompt = useAppSelector(selectDraftPrompt);
  const retryPrompt = useAppSelector(selectRetryPrompt);
  const domainDataRef = useRef(domainData);
  useEffect(() => {
    domainDataRef.current = domainData;
  }, [domainData]);
  const configState = useConfigQuery(undefined, {
    selectFromResult: ({ data, isError }) => ({
      data,
      isError,
    }),
  });
  const configStatus = getBuilderRuntimeConfigStatus(configState);
  const requestLimits = getBuilderRequestLimits(configState.data);
  const maxRepairAttempts = getBuilderMaxRepairAttempts(configState.data);
  const maxRepairValidationIssues = getBuilderMaxRepairValidationIssues(configState.data);
  const streamTimeouts = getBuilderStreamTimeouts(configState.data);
  const streamingSummary = useStreamingSummary();
  const generationLifecycle = useGenerationLifecycle({
    clearStreamingSummaryMessage: streamingSummary.clearStreamingSummaryMessage,
    onSystemNotice,
    streamMaxDurationMs: streamTimeouts?.streamMaxDurationMs ?? null,
  });
  const validationRepair = useValidationRepair({
    maxRepairAttempts,
    maxRepairValidationIssues,
    requestLimits,
    runGenerateRequest: generationLifecycle.runGenerateRequest,
    showStreamingSummaryStatus: streamingSummary.upsertStreamingStatusMessage,
    throwIfInactiveRequest: generationLifecycle.throwIfInactiveRequest,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = resolveBuilderComposerPrompt({
      draftPrompt,
      retryPrompt,
    });

    if (!nextPrompt || generationLifecycle.isSubmitting) {
      return;
    }

    if (
      configStatus !== 'loaded' ||
      requestLimits === null ||
      streamTimeouts === null ||
      maxRepairAttempts === null ||
      maxRepairValidationIssues === null
    ) {
      const runtimeConfigNotice = resolveRuntimeConfigNotice({
        configStatus,
        runtimeConfigStatusContent: null,
      });

      if (runtimeConfigNotice) {
        onSystemNotice(runtimeConfigNotice);
      }

      return;
    }

    const request: PromptBuildRequest = {
      prompt: nextPrompt,
      appMemory,
      currentSource: committedSource,
      ...(previousSource !== undefined && previousSource !== committedSource ? { previousSource } : {}),
      chatHistory: chatMessages.map(({ content, excludeFromLlmContext, role }) => ({
        content,
        excludeFromLlmContext,
        role,
      })),
      mode: 'initial',
    };
    const transportRequest = getBuilderSanitizedLlmRequestForTransport(request, requestLimits);
    const requestValidationError = validateBuilderLlmRequest(transportRequest, requestLimits);

    if (requestValidationError) {
      onSystemNotice({
        content: requestValidationError,
        tone: 'error',
      });
      return;
    }

    const { abortController, requestId } = generationLifecycle.beginGeneration(nextPrompt);

    await runBuilderGeneration({
      abortController,
      apiBaseUrl: getBackendApiBaseUrl(),
      dispatch,
      getDomainData: () => domainDataRef.current,
      lifecycle: generationLifecycle,
      request,
      requestId,
      streamTimeouts,
      streamingSummary,
      transportRequest,
      validationRepair,
    });
  }

  function handleDraftPromptChange(value: string) {
    dispatch(builderActions.setDraftPrompt(value));
  }

  return {
    configStatus,
    draftPrompt,
    handleDraftPromptChange,
    handleCancel: generationLifecycle.handleCancel,
    handleSubmit,
    isSubmitting: generationLifecycle.isSubmitting,
    promptMaxChars: requestLimits?.promptMaxChars,
    retryPrompt,
  };
}
