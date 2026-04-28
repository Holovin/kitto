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

const MAX_SUMMARY_COST_BYTES = 2048;
const HISTORY_SUMMARY_MAX_LINES = 6;
const MAX_SUMMARY_LINE_WORDS = 8;

const USER_SUMMARY_VERB_KEYWORDS: Array<{ keyword: string; verb: string }> = [
  { keyword: 'создай', verb: 'create' },
  { keyword: 'создайте', verb: 'create' },
  { keyword: 'делай', verb: 'create' },
  { keyword: 'сделай', verb: 'create' },
  { keyword: 'сделайте', verb: 'create' },
  { keyword: 'build', verb: 'create' },
  { keyword: 'builds', verb: 'create' },
  { keyword: 'creating', verb: 'create' },
  { keyword: 'generate', verb: 'create' },
  { keyword: 'start', verb: 'create' },
  { keyword: 'add', verb: 'add' },
  { keyword: 'adds', verb: 'add' },
  { keyword: 'adding', verb: 'add' },
  { keyword: 'append', verb: 'add' },
  { keyword: 'put', verb: 'add' },
  { keyword: 'include', verb: 'add' },
  { keyword: 'добавь', verb: 'add' },
  { keyword: 'добавьте', verb: 'add' },
  { keyword: 'добавил', verb: 'add' },
  { keyword: 'добавить', verb: 'add' },
  { keyword: 'remove', verb: 'remove' },
  { keyword: 'removed', verb: 'remove' },
  { keyword: 'removing', verb: 'remove' },
  { keyword: 'delete', verb: 'remove' },
  { keyword: 'удали', verb: 'remove' },
  { keyword: 'убери', verb: 'remove' },
  { keyword: 'сними', verb: 'remove' },
  { keyword: 'смен', verb: 'replace' },
  { keyword: 'replace', verb: 'replace' },
  { keyword: 'replace', verb: 'replace' },
  { keyword: 'replaced', verb: 'replace' },
  { keyword: 'changing', verb: 'replace' },
  { keyword: 'change', verb: 'replace' },
  { keyword: 'changed', verb: 'replace' },
  { keyword: 'modify', verb: 'replace' },
  { keyword: 'modified', verb: 'replace' },
  { keyword: 'modified', verb: 'replace' },
  { keyword: 'update', verb: 'replace' },
  { keyword: 'updated', verb: 'replace' },
  { keyword: 'update', verb: 'replace' },
  { keyword: 'замени', verb: 'replace' },
  { keyword: 'замените', verb: 'replace' },
  { keyword: 'переключ', verb: 'replace' },
  { keyword: 'fix', verb: 'fix' },
  { keyword: 'fixed', verb: 'fix' },
  { keyword: 'fixes', verb: 'fix' },
  { keyword: 'repair', verb: 'fix' },
  { keyword: 'исправь', verb: 'fix' },
  { keyword: 'почини', verb: 'fix' },
  { keyword: 'исправил', verb: 'fix' },
];

const ASSISTANT_SUMMARY_VERB_KEYWORDS: Array<{ keyword: string; verb: string }> = [
  { keyword: 'added', verb: 'added' },
  { keyword: 'adding', verb: 'added' },
  { keyword: 'add', verb: 'added' },
  { keyword: 'created', verb: 'added' },
  { keyword: 'created', verb: 'added' },
  { keyword: 'built', verb: 'added' },
  { keyword: 'updated', verb: 'updated' },
  { keyword: 'update', verb: 'updated' },
  { keyword: 'updated', verb: 'updated' },
  { keyword: 'updated', verb: 'updated' },
  { keyword: 'kept', verb: 'kept' },
  { keyword: 'preserved', verb: 'kept' },
  { keyword: 'removed', verb: 'removed' },
  { keyword: 'removed', verb: 'removed' },
  { keyword: 'replace', verb: 'replaced' },
  { keyword: 'replaced', verb: 'replaced' },
  { keyword: 'fixed', verb: 'fixed' },
  { keyword: 'fix', verb: 'fixed' },
  { keyword: 'rewrote', verb: 'replaced' },
  { keyword: 'changed', verb: 'updated' },
];

const SUMMARY_STOPWORDS = new Set(['a', 'an', 'the', 'to', 'and', 'on', 'for', 'with', 'в', 'и', 'на', 'по']);

function normalizeMessageText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function tokenizeMessage(value: string) {
  return normalizeMessageText(value)
    .split(' ')
    .map((token) => token.replace(/^[^a-zA-Zа-яА-ЯёЁ0-9_-]+|[^a-zA-Zа-яА-ЯёЁ0-9_-]+$/g, ''))
    .filter(Boolean);
}

function trimSummaryWords(value: string, maxWords: number) {
  const words = tokenizeMessage(value);

  if (words.length <= maxWords) {
    return words;
  }

  return words.slice(0, maxWords);
}

function normalizeSummaryObject(value: string, maxWords: number) {
  const words = trimSummaryWords(value, maxWords).filter((word) => !SUMMARY_STOPWORDS.has(word.toLowerCase()));

  if (words.length === 0) {
    return trimSummaryWords(value, maxWords).join(' ');
  }

  return words.join(' ');
}

function findFirstMatchingVerb(
  words: string[],
  mapping: Array<{ keyword: string; verb: string }>,
) {
  const lowerWords = words.map((word) => word.toLowerCase());

  for (let index = 0; index < lowerWords.length; index += 1) {
    const word = lowerWords[index];

    if (!word) {
      continue;
    }

    for (const { keyword, verb } of mapping) {
      if (word.startsWith(keyword)) {
        return { verb, remainder: words.slice(index + 1) };
      }
    }
  }

  return null;
}

function normalizeUserSummary(message: string) {
  const words = tokenizeMessage(message);
  const match = findFirstMatchingVerb(words, USER_SUMMARY_VERB_KEYWORDS);

  if (!match) {
    return normalizeSummaryObject(message, 6);
  }

  const remainder = normalizeSummaryObject(match.remainder.join(' '), MAX_SUMMARY_LINE_WORDS);

  if (remainder.trim().length === 0) {
    return match.verb;
  }

  return `${match.verb} ${remainder}`;
}

function normalizeAssistantSummary(message: string) {
  const words = tokenizeMessage(message);
  const match = findFirstMatchingVerb(words, ASSISTANT_SUMMARY_VERB_KEYWORDS);

  if (!match) {
    return normalizeSummaryObject(message, 6);
  }

  const remainder = normalizeSummaryObject(match.remainder.join(' '), MAX_SUMMARY_LINE_WORDS);

  if (remainder.trim().length === 0) {
    return match.verb;
  }

  return `${match.verb} ${remainder}`;
}

function buildTurnSummaries(
  omittedMessages: PromptBuildChatHistoryMessage[],
): Array<{ userSummary: string; assistantSummary?: string }> {
  const turns = buildPromptBuildChatHistoryTurns(omittedMessages);

  return turns
    .filter((turn) => turn.user.role === 'user' && normalizeMessageText(turn.user.content).length > 0)
    .map((turn) => {
      const userSummary = normalizeUserSummary(turn.user.content);
      const assistantMessages = turn.assistants;
      const latestAssistantMessage = assistantMessages[assistantMessages.length - 1];

      const assistantSummary = latestAssistantMessage ? normalizeAssistantSummary(latestAssistantMessage.content) : undefined;

      return {
        assistantSummary,
        userSummary,
      };
    });
}

function getTurnSummaryLines(omittedMessages: PromptBuildChatHistoryMessage[]) {
  const summaries = buildTurnSummaries(omittedMessages);

  if (summaries.length < 2) {
    return [];
  }

  const turnSummaryLines = summaries.map((summary) => {
    const lines = [`User: ${summary.userSummary}`];

    if (summary.assistantSummary) {
      lines.push(`Assistant: ${summary.assistantSummary}`);
    }

    return lines;
  });

  const selectedLines: string[] = [];
  let remainingLines = HISTORY_SUMMARY_MAX_LINES;

  for (let index = turnSummaryLines.length - 1; index >= 0 && remainingLines > 0; index -= 1) {
    const turnLines = turnSummaryLines[index];

    if (!turnLines) {
      continue;
    }

    const lineCountForThisTurn = turnLines.length;

    if (lineCountForThisTurn > remainingLines) {
      continue;
    }

    selectedLines.unshift(...turnLines);
    remainingLines -= lineCountForThisTurn;
  }

  return selectedLines.slice(-HISTORY_SUMMARY_MAX_LINES);
}

function trimToByteBudget(value: string, maxBytes: number) {
  if (value.length === 0 || maxBytes <= 0) {
    return null;
  }

  if (getTextByteLength(value) <= maxBytes) {
    return value;
  }

  for (let end = value.length - 1; end > 0; end -= 1) {
    const candidate = value.slice(0, end).trimEnd();

    if (candidate.length === 0) {
      continue;
    }

    if (getTextByteLength(`${candidate}…`) <= maxBytes) {
      return `${candidate}…`;
    }
  }

  return null;
}

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
  const summaryLines = getTurnSummaryLines(omittedMessages);
  const userAssistantPairCount = buildTurnSummaries(omittedMessages).length;

  if (userAssistantPairCount < 2 || maxSummaryCostBytes <= 0) {
    return null;
  }

  const openingTag = '<history_summary>\n';
  const closingTag = '\n</history_summary>';
  const usedTagBytes = getTextByteLength(openingTag + closingTag);
  const availableBytes = Math.max(0, maxSummaryCostBytes - usedTagBytes);
  const trimmedSummaryLines: string[] = [];
  let usedBytes = 0;

  if (summaryLines.length === 0 || summaryLines.length < 2 || maxSummaryCostBytes <= 0) {
    return null;
  }

  for (const line of summaryLines) {
    const lineText = line.length > 0 ? line : line;
    const nextLinePrefix = trimmedSummaryLines.length === 0 ? '' : '\n';
    const nextLineBytes = getTextByteLength(nextLinePrefix + lineText);

    if (usedBytes + nextLineBytes > availableBytes) {
      if (trimmedSummaryLines.length === 0) {
        const truncatedLine = trimToByteBudget(lineText, availableBytes);

        if (!truncatedLine) {
          return null;
        }

        trimmedSummaryLines.push(truncatedLine);
      }

      break;
    }

    trimmedSummaryLines.push(lineText);
    usedBytes += nextLineBytes;
  }

  if (trimmedSummaryLines.length === 0) {
    return null;
  }

  return {
    role: 'assistant',
    content: `<history_summary>\n${trimmedSummaryLines.join('\n')}\n</history_summary>`,
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

function retainHistoryForSummarySlot(
  messages: PromptBuildChatHistoryMessage[],
  maxItems: number | undefined,
) {
  if (maxItems === undefined) {
    return messages;
  }

  const maxRetainedMessages = maxItems - 1;

  if (maxRetainedMessages <= 0) {
    return null;
  }

  return messages.length <= maxRetainedMessages
    ? messages
    : retainPromptBuildChatHistory(messages, maxRetainedMessages);
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
    const summaryBudget = options.maxSummaryCostBytes ?? MAX_SUMMARY_COST_BYTES;
    const maxSummaryCostBytes = Math.max(0, Math.min(summaryBudget, MAX_SUMMARY_COST_BYTES));

    const summaryMessage = buildHistorySummaryMessage(omittedMessagesForSummary, maxSummaryCostBytes);

    if (summaryMessage) {
      const retainedHistoryForSummary = retainHistoryForSummarySlot(chatHistory, options.maxItems);

      if (!retainedHistoryForSummary) {
        return {
          chatHistory,
          compactedByBytes,
          compactedByItemLimit,
          omittedChatMessages,
        };
      }

      const additionallyOmittedMessages = getOmittedMessages(chatHistory, retainedHistoryForSummary);
      const summarizedChatHistory = insertHistorySummary(retainedHistoryForSummary, summaryMessage);
      const respectsItemLimit = options.maxItems === undefined || summarizedChatHistory.length <= options.maxItems;

      if (respectsItemLimit && options.getSizeBytes(summarizedChatHistory) <= options.maxBytes) {
        chatHistory = summarizedChatHistory;
        omittedChatMessages += additionallyOmittedMessages.length;
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
