import type { PromptBuildChatHistoryMessage, RawPromptBuildChatHistoryMessage } from './builderApiContract.js';

export type {
  PromptBuildChatHistoryMessage,
  PromptBuildChatHistoryRole,
  PromptConversationChatHistoryRole,
  RawPromptBuildChatHistoryMessage,
} from './builderApiContract.js';

export interface PromptBuildChatHistoryCompactionResult {
  chatHistory: PromptBuildChatHistoryMessage[];
  compactedByBytes: boolean;
  compactedByItemLimit: boolean;
  omittedChatMessages: number;
}

export interface CompactPromptBuildChatHistoryOptions {
  getSizeBytes: (messages: PromptBuildChatHistoryMessage[]) => number;
  maxBytes: number;
  maxItems?: number;
}

function isPromptConversationChatMessage(
  message: RawPromptBuildChatHistoryMessage,
): message is RawPromptBuildChatHistoryMessage & { role: PromptBuildChatHistoryMessage['role'] } {
  return message.role === 'assistant' || message.role === 'user';
}

function normalizeMaxItems(maxItems?: number) {
  if (typeof maxItems !== 'number' || !Number.isFinite(maxItems)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(maxItems));
}

function getFirstUserMessageIndex(messages: PromptBuildChatHistoryMessage[]) {
  return messages.findIndex((message) => message.role === 'user');
}

interface PromptBuildChatHistoryTurn {
  assistants: PromptBuildChatHistoryMessage[];
  user: PromptBuildChatHistoryMessage;
}

function buildPromptBuildChatHistoryTurns(messages: PromptBuildChatHistoryMessage[]) {
  const turns: PromptBuildChatHistoryTurn[] = [];
  let currentTurn: PromptBuildChatHistoryTurn | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      currentTurn = {
        assistants: [],
        user: message,
      };
      turns.push(currentTurn);
      continue;
    }

    if (!currentTurn) {
      continue;
    }

    currentTurn.assistants.push(message);
  }

  return turns;
}

function retainNewestTurnAwareTail(
  messages: PromptBuildChatHistoryMessage[],
  maxItems: number,
): PromptBuildChatHistoryMessage[] {
  const normalizedMaxItems = normalizeMaxItems(maxItems);

  if (normalizedMaxItems <= 0) {
    return [];
  }

  if (!Number.isFinite(normalizedMaxItems) || messages.length <= normalizedMaxItems) {
    return messages;
  }

  const turns = buildPromptBuildChatHistoryTurns(messages);

  if (turns.length === 0) {
    return messages.slice(-normalizedMaxItems);
  }

  const retainedTurns: PromptBuildChatHistoryMessage[][] = [];
  let remainingItems = normalizedMaxItems;

  for (let index = turns.length - 1; index >= 0 && remainingItems > 0; index -= 1) {
    const turn = turns[index];

    if (!turn) {
      continue;
    }

    const turnMessages = [turn.user, ...turn.assistants];
    const retainedTurnMessages = turnMessages.slice(0, remainingItems);

    retainedTurns.unshift(retainedTurnMessages);
    remainingItems -= retainedTurnMessages.length;
  }

  return retainedTurns.flat();
}

export function retainPromptBuildChatHistoryTail(
  messages: PromptBuildChatHistoryMessage[],
  latestTailCount: number,
): PromptBuildChatHistoryMessage[] {
  if (messages.length === 0) {
    return [];
  }

  const normalizedTailCount = Math.max(0, Math.min(messages.length, Math.floor(latestTailCount)));
  const firstUserMessageIndex = getFirstUserMessageIndex(messages);
  const firstUserMessage = firstUserMessageIndex >= 0 ? messages[firstUserMessageIndex] : null;

  if (normalizedTailCount === 0) {
    return firstUserMessage ? [firstUserMessage] : [];
  }

  if (!firstUserMessage) {
    return retainNewestTurnAwareTail(messages, normalizedTailCount);
  }

  const tailMessages = retainNewestTurnAwareTail(messages.slice(firstUserMessageIndex + 1), normalizedTailCount);

  return [firstUserMessage, ...tailMessages];
}

export function retainPromptBuildChatHistory(
  messages: PromptBuildChatHistoryMessage[],
  maxItems?: number,
): PromptBuildChatHistoryMessage[] {
  const normalizedMaxItems = normalizeMaxItems(maxItems);

  if (normalizedMaxItems <= 0) {
    return [];
  }

  if (!Number.isFinite(normalizedMaxItems) || messages.length <= normalizedMaxItems) {
    return messages;
  }

  const firstUserMessageIndex = getFirstUserMessageIndex(messages);
  const firstUserMessage = firstUserMessageIndex >= 0 ? messages[firstUserMessageIndex] : null;

  if (!firstUserMessage) {
    return messages.slice(-normalizedMaxItems);
  }

  if (normalizedMaxItems === 1) {
    return [firstUserMessage];
  }

  return retainPromptBuildChatHistoryTail(messages, normalizedMaxItems - 1);
}

export function filterPromptBuildChatHistory(
  messages: RawPromptBuildChatHistoryMessage[],
  maxItems?: number,
): PromptBuildChatHistoryMessage[] {
  const normalizedMaxItems = normalizeMaxItems(maxItems);

  if (normalizedMaxItems <= 0) {
    return [];
  }

  const filteredMessages = messages
    .filter(isPromptConversationChatMessage)
    .filter((message) => message.content.trim().length > 0)
    .filter((message) => message.excludeFromLlmContext !== true)
    .map(({ content, role }) => ({ content, role }));

  if (!Number.isFinite(normalizedMaxItems)) {
    return filteredMessages;
  }

  return filteredMessages.slice(-normalizedMaxItems);
}

export function compactPromptBuildChatHistory(
  messages: RawPromptBuildChatHistoryMessage[],
  options: CompactPromptBuildChatHistoryOptions,
): PromptBuildChatHistoryCompactionResult {
  const filteredMessages = filterPromptBuildChatHistory(messages);
  let compactedByBytes = false;
  let compactedByItemLimit = false;
  let omittedChatMessages = 0;
  let chatHistory = filteredMessages;

  if (typeof options.maxItems === 'number' && Number.isFinite(options.maxItems) && chatHistory.length > options.maxItems) {
    const retainedChatHistory = retainPromptBuildChatHistory(chatHistory, options.maxItems);
    omittedChatMessages += chatHistory.length - retainedChatHistory.length;
    compactedByItemLimit = true;
    chatHistory = retainedChatHistory;
  }

  if (options.getSizeBytes(chatHistory) > options.maxBytes && chatHistory.length > 0) {
    compactedByBytes = true;
    let maximumRetainedTailCount: number | null = null;
    let lowerBound = 0;
    let upperBound = chatHistory.length;

    while (lowerBound <= upperBound) {
      const retainedTailCount = Math.floor((lowerBound + upperBound) / 2);
      const retainedChatHistory = retainPromptBuildChatHistoryTail(chatHistory, retainedTailCount);

      if (options.getSizeBytes(retainedChatHistory) <= options.maxBytes) {
        maximumRetainedTailCount = retainedTailCount;
        lowerBound = retainedTailCount + 1;
        continue;
      }

      upperBound = retainedTailCount - 1;
    }

    const retainedChatHistory =
      maximumRetainedTailCount === null ? [] : retainPromptBuildChatHistoryTail(chatHistory, maximumRetainedTailCount);

    omittedChatMessages += chatHistory.length - retainedChatHistory.length;
    chatHistory = retainedChatHistory;
  }

  return {
    chatHistory,
    compactedByBytes,
    compactedByItemLimit,
    omittedChatMessages,
  };
}
