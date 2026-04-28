import type {
  BuilderChatMessage,
  BuilderPromptContextSection,
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

export function buildPreviousUserMessages(messages: BuilderChatMessage[]) {
  return collectPreviousUserMessages(messages);
}

export function buildPreviousChangeSummaries(changeSummaries: string[]) {
  return collectPreviousChangeSummaries(changeSummaries);
}

export function buildStaticPromptInfoContextSections(promptInfo?: PromptsInfoResponse): ContextMeterSection[] {
  return promptInfo?.staticPromptContextSections ?? [
    {
      chars: 0,
      content: '(loading backend prompt config from /api/prompts/info)',
      included: false,
      name: 'system/contract',
      priority: 1,
      protected: true,
      reason: 'loading',
    },
  ];
}

export function applyBackendPromptContextDisplayMetadata(
  sections: ContextMeterSection[],
  promptInfo?: PromptsInfoResponse,
): ContextMeterSection[] {
  if (!promptInfo) {
    return sections;
  }

  const staticSectionByName = new Map(promptInfo.staticPromptContextSections.map((section) => [section.name, section]));

  return sections.map((section) => {
    const staticSection = staticSectionByName.get(section.name);

    if (!staticSection?.limitLabels?.length || section.limitLabels?.length) {
      return section;
    }

    return {
      ...section,
      limitLabels: staticSection.limitLabels,
    };
  });
}
