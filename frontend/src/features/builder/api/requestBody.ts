import type { BuilderLlmRequest } from '@features/builder/types';

type SerializedBuilderLlmRequest = Pick<BuilderLlmRequest, 'chatHistory' | 'currentSource' | 'mode' | 'prompt'> & {
  invalidDraft?: BuilderLlmRequest['invalidDraft'];
  parentRequestId?: BuilderLlmRequest['parentRequestId'];
  repairAttemptNumber?: BuilderLlmRequest['repairAttemptNumber'];
  validationIssues?: BuilderLlmRequest['validationIssues'];
};

export function createBuilderLlmRequestPayload(request: BuilderLlmRequest): SerializedBuilderLlmRequest {
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

export function serializeBuilderLlmRequest(request: BuilderLlmRequest) {
  return JSON.stringify(createBuilderLlmRequestPayload(request));
}
