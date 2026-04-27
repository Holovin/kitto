import type { PromptBuildRequest } from '@pages/Chat/builder/types';

type SerializedBuilderLlmRequest = Pick<PromptBuildRequest, 'chatHistory' | 'currentSource' | 'mode' | 'prompt'> & {
  invalidDraft?: PromptBuildRequest['invalidDraft'];
  parentRequestId?: PromptBuildRequest['parentRequestId'];
  repairAttemptNumber?: PromptBuildRequest['repairAttemptNumber'];
  validationIssues?: PromptBuildRequest['validationIssues'];
};

function createBuilderLlmRequestPayload(request: PromptBuildRequest): SerializedBuilderLlmRequest {
  const payload: SerializedBuilderLlmRequest = {
    prompt: request.prompt,
    currentSource: request.currentSource,
    chatHistory: request.chatHistory,
    mode: request.mode,
  };

  if (request.parentRequestId !== undefined) {
    payload.parentRequestId = request.parentRequestId;
  }

  if (request.repairAttemptNumber !== undefined) {
    payload.repairAttemptNumber = request.repairAttemptNumber;
  }

  if (request.invalidDraft !== undefined) {
    payload.invalidDraft = request.invalidDraft;
  }

  if (request.validationIssues !== undefined) {
    payload.validationIssues = request.validationIssues;
  }

  return payload;
}

export function serializeBuilderLlmRequest(request: PromptBuildRequest) {
  return JSON.stringify(createBuilderLlmRequestPayload(request));
}
