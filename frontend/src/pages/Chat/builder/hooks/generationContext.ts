import {
  createEmptyAppMemory,
  PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS,
  PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
  PREVIOUS_USER_MESSAGES_MAX_ITEMS,
  PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS,
} from '@kitto-openui/shared/builderApiContract.js';
import type {
  AppMemory,
  BuilderChatMessage,
  BuilderPromptContextSection,
  BudgetDecisionSection,
  PromptsInfoResponse,
} from '@pages/Chat/builder/types';

export type ContextMeterSection = BuilderPromptContextSection;

function trimToTotalChars(values: string[], maxTotalChars: number) {
  const selected: string[] = [];
  let remainingChars = maxTotalChars;

  for (let index = values.length - 1; index >= 0 && remainingChars > 0; index -= 1) {
    const value = values[index]?.trim();

    if (!value) {
      continue;
    }

    const nextValue = value.length > remainingChars ? value.slice(0, remainingChars).trimEnd() : value;

    if (!nextValue) {
      continue;
    }

    selected.unshift(nextValue);
    remainingChars -= nextValue.length;
  }

  return selected;
}

export function buildPreviousUserMessages(messages: BuilderChatMessage[]) {
  const previousUserMessages = messages.flatMap((message) => {
    if (message.role !== 'user' || message.excludeFromLlmContext) {
      return [];
    }

    const content = message.content.trim();
    return content ? [content] : [];
  });

  return trimToTotalChars(previousUserMessages.slice(-PREVIOUS_USER_MESSAGES_MAX_ITEMS), PREVIOUS_USER_MESSAGES_MAX_TOTAL_CHARS);
}

export function buildPreviousChangeSummaries(changeSummaries: string[]) {
  const previousChangeSummaries = changeSummaries.flatMap((summary) => {
    const content = summary.trim();
    return content ? [content] : [];
  });

  return trimToTotalChars(
    previousChangeSummaries.slice(-PREVIOUS_CHANGE_SUMMARIES_MAX_ITEMS),
    PREVIOUS_CHANGE_SUMMARIES_MAX_TOTAL_CHARS,
  );
}

function getJsonChars(value: unknown) {
  return JSON.stringify(value ?? null).length;
}

function createMeterSection(
  priority: number,
  name: string,
  chars: number,
  included: boolean,
  protectedSection: boolean,
  content: string,
  reason?: string,
  options: {
    unminifiedChars?: number;
  } = {},
): ContextMeterSection {
  return {
    name,
    chars,
    content,
    included,
    priority,
    protected: protectedSection,
    ...(reason ? { reason } : {}),
    ...(options.unminifiedChars !== undefined && options.unminifiedChars !== chars
      ? { unminifiedChars: options.unminifiedChars }
      : {}),
  };
}

function buildPromptDataBlock(tagName: string, content: string) {
  return `<${tagName}>\n${content}\n</${tagName}>`;
}

export function buildContextMeterSections({
  appMemory,
  currentSource,
  latestUserPrompt,
  previousChangeSummaries,
  previousUserMessages,
}: {
  appMemory?: AppMemory;
  currentSource: string;
  latestUserPrompt: string;
  previousChangeSummaries: string[];
  previousUserMessages: string[];
}) {
  const hasCurrentSource = currentSource.trim().length > 0;
  const normalizedLatestUserPrompt = latestUserPrompt.trim();
  const normalizedAppMemory = appMemory ?? createEmptyAppMemory();
  const previousUserMessagesContent = previousUserMessages.length > 0
    ? buildPromptDataBlock('previous_user_messages', JSON.stringify(previousUserMessages))
    : '(omitted; no previous user messages selected)';
  const previousChangeSummariesContent = previousChangeSummaries.length > 0
    ? buildPromptDataBlock('previous_change_summaries', JSON.stringify(previousChangeSummaries))
    : '(omitted; no previous change summaries selected)';

  return [
    createMeterSection(
      1,
      'system/contract',
      0,
      true,
      true,
      '(hidden static prefix; backend owns the stable system, component/tool, and structured-output contract)',
      'hidden static prefix',
    ),
    createMeterSection(
      2,
      'latestUserPrompt',
      normalizedLatestUserPrompt.length,
      normalizedLatestUserPrompt.length > 0,
      true,
      normalizedLatestUserPrompt
        ? buildPromptDataBlock('latest_user_request', normalizedLatestUserPrompt)
        : '(empty latest user request)',
    ),
    createMeterSection(
      3,
      'currentSource',
      currentSource.length,
      hasCurrentSource,
      true,
      buildPromptDataBlock('current_source', hasCurrentSource ? currentSource : '(blank canvas, no current OpenUI source yet)'),
      hasCurrentSource ? 'protected' : 'blank canvas',
    ),
    createMeterSection(
      4,
      'appMemory',
      getJsonChars(normalizedAppMemory),
      true,
      false,
      buildPromptDataBlock('previous_app_memory', JSON.stringify(normalizedAppMemory)),
    ),
    createMeterSection(
      5,
      'historySummary',
      0,
      false,
      false,
      '(omitted; no compact history summary is currently stored in the browser state)',
      'omitted',
    ),
    createMeterSection(
      6,
      'previousUserMessages',
      getJsonChars(previousUserMessages),
      previousUserMessages.length > 0,
      false,
      previousUserMessagesContent,
    ),
    createMeterSection(
      7,
      'previousChangeSummaries',
      getJsonChars(previousChangeSummaries),
      previousChangeSummaries.length > 0,
      false,
      previousChangeSummariesContent,
    ),
    createMeterSection(
      8,
      'examples',
      0,
      false,
      false,
      '(selected by backend from request intent; omitted from browser-side meter payload)',
      'backend optional',
    ),
    createMeterSection(
      9,
      'currentSourceItems',
      0,
      false,
      false,
      '(omitted; current source inventory is optional hint context and never replaces currentSource)',
      'omitted',
    ),
  ];
}

export function buildStaticPromptInfoContextSections(promptInfo?: PromptsInfoResponse): ContextMeterSection[] {
  if (!promptInfo) {
    return [
      createMeterSection(
        1,
        'system/contract',
        0,
        false,
        true,
        '(loading backend prompt config from /api/prompts/info)',
        'loading',
      ),
    ];
  }

  const staticSections = promptInfo.staticPromptContextSections;

  return [
    ...staticSections.filter((section) => section.priority < 4),
    createMeterSection(
      4,
      'latestUserPrompt',
      0,
      false,
      true,
      '(no generation request has been sent yet; this section is populated from the backend response after Send)',
      'waiting for request',
    ),
    createMeterSection(
      5,
      'currentSource',
      0,
      false,
      true,
      '(no generation request has been sent yet; this section is populated from the backend response after Send)',
      'waiting for request',
    ),
    ...staticSections.filter((section) => section.priority >= 6),
  ];
}

export function formatContextMeterTooltip(sections: BudgetDecisionSection[]) {
  const formatNumber = new Intl.NumberFormat();
  const lines = ['Context:'];

  for (const section of sections) {
    const charLabel = `${formatNumber.format(section.chars)} chars${section.protected ? ' protected' : ''}`;
    const status = section.included ? (section.chars === 0 && section.reason ? section.reason : charLabel) : section.reason ?? 'omitted';

    lines.push(`- ${section.name}: ${status}`);
  }

  return lines.join('\n');
}
