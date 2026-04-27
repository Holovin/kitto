import type { PromptBuildChatHistoryMessage, RawPromptBuildChatHistoryMessage } from './builderApiContract.js';

export type {
  PromptBuildChatHistoryMessage,
  PromptBuildChatHistoryRole,
  PromptConversationChatHistoryRole,
  RawPromptBuildChatHistoryMessage,
} from './builderApiContract.js';

interface PromptBuildChatHistoryCompactionResult {
  chatHistory: PromptBuildChatHistoryMessage[];
  compactedByBytes: boolean;
  compactedByItemLimit: boolean;
  omittedChatMessages: number;
}

interface CompactPromptBuildChatHistoryOptions {
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
  return maxItems ?? Number.POSITIVE_INFINITY;
}

const SEMINAL_CREATE_REQUEST_PATTERN =
  /\b(?:new|fresh)\s+(?:app|application|tool|experience)\b|\bfrom\s+scratch\b|^\s*(?:create|build|make|generate)\s+(?:a|an|the)?\s*.*\b(?:app|application|tool|showcase|quiz|form|list|dashboard|planner|tracker|counter|calculator|catalog|wizard)\b|(?:создай|сделай|построй|сгенерируй)\s+(?:нов[а-яё]*\s+)?(?:приложен[а-яё]*|форм[а-яё]*|спис[а-яё]*|квиз[а-яё]*|дашборд[а-яё]*|планировщик[а-яё]*)/i;
const SEMINAL_MODIFY_REQUEST_PATTERN =
  /^\s*(?:add|append|change|edit|extend|fix|keep|modify|preserve|remove|rename|switch|turn\s+(?:it|this)|update)\b|^\s*(?:добавь|дополни|измени|исправь|обнови|оставь|переименуй|сохрани|удали)\b/i;

function getFirstUserMessageIndex(messages: PromptBuildChatHistoryMessage[]) {
  return messages.findIndex((message) => message.role === 'user');
}

function isSeminalUserIntentMessage(message: PromptBuildChatHistoryMessage) {
  return (
    message.role === 'user' &&
    (SEMINAL_CREATE_REQUEST_PATTERN.test(message.content) || SEMINAL_MODIFY_REQUEST_PATTERN.test(message.content))
  );
}

function getSeminalUserMessageIndex(messages: PromptBuildChatHistoryMessage[]) {
  const firstSeminalUserMessageIndex = messages.findIndex(isSeminalUserIntentMessage);

  return firstSeminalUserMessageIndex >= 0 ? firstSeminalUserMessageIndex : getFirstUserMessageIndex(messages);
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
  const seminalUserMessageIndex = getSeminalUserMessageIndex(messages);
  const seminalUserMessage = seminalUserMessageIndex >= 0 ? messages[seminalUserMessageIndex] : null;

  if (normalizedTailCount === 0) {
    return seminalUserMessage ? [seminalUserMessage] : [];
  }

  if (!seminalUserMessage) {
    return retainNewestTurnAwareTail(messages, normalizedTailCount);
  }

  const tailMessages = retainNewestTurnAwareTail(messages.slice(seminalUserMessageIndex + 1), normalizedTailCount);

  return [seminalUserMessage, ...tailMessages];
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

  const seminalUserMessageIndex = getSeminalUserMessageIndex(messages);
  const seminalUserMessage = seminalUserMessageIndex >= 0 ? messages[seminalUserMessageIndex] : null;

  if (!seminalUserMessage) {
    return messages.slice(-normalizedMaxItems);
  }

  if (normalizedMaxItems === 1) {
    return [seminalUserMessage];
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

  return retainPromptBuildChatHistory(filteredMessages, normalizedMaxItems);
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

  if (options.maxItems !== undefined && chatHistory.length > options.maxItems) {
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
