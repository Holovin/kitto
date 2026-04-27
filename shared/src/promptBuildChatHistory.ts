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
  maxSummaryCostBytes?: number;
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

function getMessageKey(message: PromptBuildChatHistoryMessage) {
  return `${message.role}\u0000${message.content}`;
}

function getTextByteLength(value: string) {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);

    if (codePoint < 0x80) {
      bytes += 1;
    } else if (codePoint < 0x800) {
      bytes += 2;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function getOmittedMessages(
  previousMessages: PromptBuildChatHistoryMessage[],
  retainedMessages: PromptBuildChatHistoryMessage[],
) {
  const retainedCounts = new Map<string, number>();

  for (const message of retainedMessages) {
    const key = getMessageKey(message);
    retainedCounts.set(key, (retainedCounts.get(key) ?? 0) + 1);
  }

  return previousMessages.filter((message) => {
    const key = getMessageKey(message);
    const retainedCount = retainedCounts.get(key) ?? 0;

    if (retainedCount > 0) {
      retainedCounts.set(key, retainedCount - 1);
      return false;
    }

    return true;
  });
}

function buildHistorySummaryMessage(
  omittedMessages: PromptBuildChatHistoryMessage[],
  maxSummaryCostBytes: number,
): PromptBuildChatHistoryMessage | null {
  const userAssistantPairCount = Math.floor(omittedMessages.filter((message) => message.role === 'user').length);

  if (userAssistantPairCount < 2 || maxSummaryCostBytes <= 0) {
    return null;
  }

  const clippedMessages: string[] = [];
  let remainingBytes = maxSummaryCostBytes;

  for (const message of omittedMessages) {
    const line = `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content.trim().replace(/\s+/g, ' ')}`;
    const lineBytes = getTextByteLength(line);

    if (lineBytes > remainingBytes && clippedMessages.length > 0) {
      break;
    }

    clippedMessages.push(lineBytes > remainingBytes ? `${line.slice(0, Math.max(1, remainingBytes - 1)).trimEnd()}…` : line);
    remainingBytes -= Math.min(lineBytes, remainingBytes);

    if (remainingBytes <= 0) {
      break;
    }
  }

  if (clippedMessages.length === 0) {
    return null;
  }

  return {
    role: 'assistant',
    content: `<history_summary>\nEarlier omitted chat context: ${clippedMessages.join(' | ')}\n</history_summary>`,
  };
}

function insertHistorySummary(
  retainedMessages: PromptBuildChatHistoryMessage[],
  summaryMessage: PromptBuildChatHistoryMessage,
) {
  const firstUserMessageIndex = getFirstUserMessageIndex(retainedMessages);

  if (firstUserMessageIndex < 0) {
    return [summaryMessage, ...retainedMessages];
  }

  return [
    ...retainedMessages.slice(0, firstUserMessageIndex + 1),
    summaryMessage,
    ...retainedMessages.slice(firstUserMessageIndex + 1),
  ];
}

function trimSummarizedHistoryToMaxItems(
  messages: PromptBuildChatHistoryMessage[],
  summaryMessage: PromptBuildChatHistoryMessage,
  maxItems: number | undefined,
) {
  if (maxItems === undefined || messages.length <= maxItems) {
    return messages;
  }

  const trimmedMessages = [...messages];

  while (trimmedMessages.length > maxItems) {
    const removableIndex = trimmedMessages.findIndex(
      (message, index) => index > 0 && message !== summaryMessage,
    );

    if (removableIndex < 0) {
      break;
    }

    trimmedMessages.splice(removableIndex, 1);
  }

  return trimmedMessages;
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
  const omittedMessagesForSummary: PromptBuildChatHistoryMessage[] = [];
  let compactedByBytes = false;
  let compactedByItemLimit = false;
  let omittedChatMessages = 0;
  let chatHistory = filteredMessages;

  if (options.maxItems !== undefined && chatHistory.length > options.maxItems) {
    const retainedChatHistory = retainPromptBuildChatHistory(chatHistory, options.maxItems);
    omittedMessagesForSummary.push(...getOmittedMessages(chatHistory, retainedChatHistory));
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

    omittedMessagesForSummary.push(...getOmittedMessages(chatHistory, retainedChatHistory));
    omittedChatMessages += chatHistory.length - retainedChatHistory.length;
    chatHistory = retainedChatHistory;
  }

  if (omittedMessagesForSummary.length > 0) {
    const summaryMessage = buildHistorySummaryMessage(omittedMessagesForSummary, options.maxSummaryCostBytes ?? 2_000);

    if (summaryMessage) {
      const summarizedChatHistory = trimSummarizedHistoryToMaxItems(
        insertHistorySummary(chatHistory, summaryMessage),
        summaryMessage,
        options.maxItems,
      );
      const respectsItemLimit = options.maxItems === undefined || summarizedChatHistory.length <= options.maxItems;

      if (respectsItemLimit && options.getSizeBytes(summarizedChatHistory) <= options.maxBytes) {
        chatHistory = summarizedChatHistory;
      }
    }
  }

  return {
    chatHistory,
    compactedByBytes,
    compactedByItemLimit,
    omittedChatMessages,
  };
}
