import { env } from '../env.js';
import type { BuilderMessage, GenerateSpecInput, RequestCompactionAction, RequestNormalizationMeta } from './types.js';

const requestEncoder = new TextEncoder();

export class RequestNormalizationError extends Error {
  status: number;
  headers: Record<string, string>;

  constructor(message: string, status: number, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'RequestNormalizationError';
    this.status = status;
    this.headers = headers;
  }
}

function getRequestBytes(input: GenerateSpecInput) {
  return requestEncoder.encode(JSON.stringify(input)).length;
}

function normalizeMessages(messages?: BuilderMessage[]) {
  return messages
    ?.map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0);
}

function createHeaders(meta: RequestNormalizationMeta) {
  if (!meta.compacted) {
    return {} as Record<string, string>;
  }

  return {
    'X-Kitto-Request-Compacted': 'true',
    'X-Kitto-Request-Compaction-Actions': meta.actions.join(','),
    'X-Kitto-Request-Bytes': String(meta.requestBytes),
    'X-Kitto-Request-Dropped-Messages': String(meta.droppedMessages),
    'X-Kitto-Request-Dropped-Raw-Lines': meta.droppedRawLines ? '1' : '0',
  } satisfies Record<string, string>;
}

export function applyRequestNormalizationHeaders(headers: Headers, meta: RequestNormalizationMeta) {
  for (const [key, value] of Object.entries(createHeaders(meta))) {
    headers.set(key, value);
  }
}

export function normalizeGenerateInput(input: GenerateSpecInput) {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new RequestNormalizationError('Prompt is required.', 400);
  }

  if (prompt.length > env.LLM_PROMPT_MAX_CHARS) {
    throw new RequestNormalizationError(`Prompt exceeds the ${env.LLM_PROMPT_MAX_CHARS} character limit.`, 400);
  }

  let messages = normalizeMessages(input.messages) ?? [];
  let droppedMessages = 0;
  const actions = new Set<RequestCompactionAction>();

  if (messages.length > env.LLM_CHAT_HISTORY_MAX_ITEMS) {
    droppedMessages = messages.length - env.LLM_CHAT_HISTORY_MAX_ITEMS;
    messages = messages.slice(-env.LLM_CHAT_HISTORY_MAX_ITEMS);
    actions.add('chat-history');
  }

  let repairContext = input.repairContext
    ? {
        attempt: input.repairContext.attempt,
        error: input.repairContext.error.trim(),
        rawLines: input.repairContext.rawLines?.map((line) => line.trim()).filter(Boolean),
      }
    : undefined;
  let droppedRawLines = false;

  const currentSpec = input.currentSpec ?? null;
  const runtimeState = input.runtimeState ?? null;

  function buildInput(): GenerateSpecInput {
    return {
      prompt,
      messages: messages.length > 0 ? messages : undefined,
      currentSpec,
      runtimeState,
      repairContext,
    };
  }

  let normalizedInput = buildInput();
  let requestBytes = getRequestBytes(normalizedInput);

  if (requestBytes > env.LLM_REQUEST_MAX_BYTES && repairContext?.rawLines?.length) {
    repairContext = {
      ...repairContext,
      rawLines: undefined,
    };
    droppedRawLines = true;
    actions.add('repair-raw-lines');
    normalizedInput = buildInput();
    requestBytes = getRequestBytes(normalizedInput);
  }

  while (requestBytes > env.LLM_REQUEST_MAX_BYTES && messages.length > 0) {
    messages = messages.slice(1);
    droppedMessages += 1;
    actions.add('chat-history');
    normalizedInput = buildInput();
    requestBytes = getRequestBytes(normalizedInput);
  }

  const meta: RequestNormalizationMeta = {
    compacted: actions.size > 0,
    actions: [...actions],
    requestBytes,
    droppedMessages,
    droppedRawLines,
  };

  if (requestBytes > env.LLM_REQUEST_MAX_BYTES) {
    throw new RequestNormalizationError(
      `Normalized request exceeds the ${env.LLM_REQUEST_MAX_BYTES} byte limit even after compaction.`,
      413,
      createHeaders(meta),
    );
  }

  return {
    input: normalizedInput,
    meta,
  };
}
