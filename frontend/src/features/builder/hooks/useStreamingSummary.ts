import { builderActions } from '@features/builder/store/builderSlice';
import type { BuilderRequestId } from '@features/builder/types';
import { useAppDispatch } from '@store/hooks';
import { store } from '@store/store';

function getStreamingSummaryMessageKey(requestId: BuilderRequestId) {
  return `generation-summary:${requestId}`;
}

function formatPendingSummary(summary: string) {
  const trimmedSummary = summary.trim();

  if (!trimmedSummary) {
    return '';
  }

  return `Building: ${trimmedSummary}${trimmedSummary.endsWith('…') ? '' : '…'}`;
}

function normalizeCommittedSummary(messageContent: string) {
  const trimmedContent = messageContent.trim();

  if (!trimmedContent.startsWith('Building: ')) {
    return trimmedContent;
  }

  const normalizedSummary = trimmedContent.slice('Building: '.length).trim();
  return normalizedSummary.endsWith('…') ? normalizedSummary.slice(0, -1).trim() : normalizedSummary;
}

export function useStreamingSummary() {
  const dispatch = useAppDispatch();

  function clearStreamingSummaryMessage(requestId: BuilderRequestId) {
    dispatch(
      builderActions.removeChatMessageByKey({
        messageKey: getStreamingSummaryMessageKey(requestId),
      }),
    );
  }

  function getCommittedSummary(requestId: BuilderRequestId, summary?: string) {
    const trimmedSummary = typeof summary === 'string' ? summary.trim() : '';

    if (trimmedSummary) {
      return trimmedSummary;
    }

    const pendingSummaryMessage = store
      .getState()
      .builder.chatMessages.find((message) => message.messageKey === getStreamingSummaryMessageKey(requestId));

    if (!pendingSummaryMessage) {
      return '';
    }

    return normalizeCommittedSummary(pendingSummaryMessage.content);
  }

  function upsertStreamingSummaryMessage(requestId: BuilderRequestId, summary: string, options?: { pending?: boolean }) {
    const trimmedSummary = summary.trim();

    if (!trimmedSummary) {
      return;
    }

    dispatch(
      builderActions.appendChatMessage({
        content: options?.pending ? formatPendingSummary(trimmedSummary) : trimmedSummary,
        messageKey: getStreamingSummaryMessageKey(requestId),
        role: 'assistant',
      }),
    );
  }

  return {
    clearStreamingSummaryMessage,
    getCommittedSummary,
    upsertStreamingSummaryMessage,
  };
}
