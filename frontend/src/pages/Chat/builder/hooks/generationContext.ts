import { createEmptyAppMemory } from '@kitto-openui/shared/builderApiContract.js';
import type {
  AppMemory,
  BuilderChatMessage,
  BuilderPromptContextSection,
  BudgetDecisionSection,
  PromptsInfoResponse,
} from '@pages/Chat/builder/types';

export type ContextMeterSection = BuilderPromptContextSection;

function collectPreviousUserMessages(messages: BuilderChatMessage[]) {
  return messages.flatMap((message) => {
    if (message.role !== 'user' || message.excludeFromLlmContext) {
      return [];
    }

    const content = message.content.trim();
    return content ? [content] : [];
  });
}

function collectPreviousChangeSummaries(changeSummaries: string[]) {
  return changeSummaries.flatMap((summary) => {
    const content = summary.trim();
    return content ? [content] : [];
  });
}

function normalizeHistorySummary(historySummary?: string) {
  const trimmedSummary = historySummary?.trim();
  return trimmedSummary || undefined;
}

export function buildPreviousUserMessages(messages: BuilderChatMessage[]) {
  return collectPreviousUserMessages(messages);
}

export function buildPreviousChangeSummaries(changeSummaries: string[]) {
  return collectPreviousChangeSummaries(changeSummaries);
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
    hardLimitChars?: number;
    softLimitChars?: number;
    unminifiedChars?: number;
  } = {},
): ContextMeterSection {
  return {
    name,
    chars,
    content,
    ...(options.hardLimitChars !== undefined ? { hardLimitChars: options.hardLimitChars } : {}),
    included,
    priority,
    protected: protectedSection,
    ...(reason ? { reason } : {}),
    ...(options.softLimitChars !== undefined ? { softLimitChars: options.softLimitChars } : {}),
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
  historySummary,
}: {
  appMemory?: AppMemory;
  currentSource: string;
  historySummary?: string;
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
  const normalizedHistorySummary = normalizeHistorySummary(historySummary);

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
      undefined,
    ),
    createMeterSection(
      5,
      'historySummary',
      normalizedHistorySummary?.length ?? 0,
      Boolean(normalizedHistorySummary),
      false,
      normalizedHistorySummary
        ? buildPromptDataBlock('history_summary', normalizedHistorySummary)
        : '(omitted; no compact history summary is currently stored in the browser state)',
      normalizedHistorySummary ? undefined : 'omitted',
    ),
    createMeterSection(
      6,
      'previousUserMessages',
      getJsonChars(previousUserMessages),
      previousUserMessages.length > 0,
      false,
      previousUserMessagesContent,
      undefined,
    ),
    createMeterSection(
      7,
      'previousChangeSummaries',
      getJsonChars(previousChangeSummaries),
      previousChangeSummaries.length > 0,
      false,
      previousChangeSummariesContent,
      undefined,
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

function getPromptContextLimit(promptInfo: PromptsInfoResponse, name: string) {
  return promptInfo.promptContextLimits.find((section) => section.name === name);
}

function applyPromptContextLimit(section: ContextMeterSection, limit?: BudgetDecisionSection): ContextMeterSection {
  if (!limit) {
    return section;
  }

  return {
    ...section,
    ...(section.hardLimitChars === undefined && limit.hardLimitChars !== undefined
      ? { hardLimitChars: limit.hardLimitChars }
      : {}),
    ...(section.softLimitChars === undefined && limit.softLimitChars !== undefined
      ? { softLimitChars: limit.softLimitChars }
      : {}),
  };
}

export function applyPromptContextLimits(
  sections: ContextMeterSection[],
  promptInfo?: PromptsInfoResponse,
): ContextMeterSection[] {
  if (!promptInfo) {
    return sections;
  }

  return sections.map((section) => applyPromptContextLimit(section, getPromptContextLimit(promptInfo, section.name)));
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

  const staticSections = applyPromptContextLimits(promptInfo.staticPromptContextSections, promptInfo);

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
      getPromptContextLimit(promptInfo, 'latestUserPrompt'),
    ),
    createMeterSection(
      5,
      'currentSource',
      0,
      false,
      true,
      '(no generation request has been sent yet; this section is populated from the backend response after Send)',
      'waiting for request',
      getPromptContextLimit(promptInfo, 'currentSource'),
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
