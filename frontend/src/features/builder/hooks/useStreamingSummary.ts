import { useEffect, useRef } from 'react';
import { builderActions } from '@features/builder/store/builderSlice';
import type { BuilderRequestId } from '@features/builder/types';
import { useAppDispatch } from '@store/hooks';
import { store } from '@store/store';

const PENDING_SUMMARY_THROTTLE_MS = 150;

interface PendingSummaryState {
  excludeFromLlmContext?: boolean;
  lastFlushedAt: number | null;
  latestSummary: string;
  timerId: ReturnType<typeof setTimeout> | null;
}

function getStreamingSummaryMessageKey(requestId: BuilderRequestId) {
  return `generation-summary:${requestId}`;
}

function formatPendingSummary(summary: string) {
  return summary.trim();
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
  const pendingSummaryStatesRef = useRef<Map<BuilderRequestId, PendingSummaryState>>(new Map());

  useEffect(() => {
    const pendingSummaryStates = pendingSummaryStatesRef.current;

    return () => {
      for (const pendingSummaryState of pendingSummaryStates.values()) {
        if (pendingSummaryState.timerId !== null) {
          clearTimeout(pendingSummaryState.timerId);
        }
      }

      pendingSummaryStates.clear();
    };
  }, []);

  function clearPendingSummaryTimer(pendingSummaryState?: PendingSummaryState) {
    if (!pendingSummaryState || pendingSummaryState.timerId === null) {
      return;
    }

    clearTimeout(pendingSummaryState.timerId);
    pendingSummaryState.timerId = null;
  }

  function getPendingSummaryState(requestId: BuilderRequestId) {
    const existingState = pendingSummaryStatesRef.current.get(requestId);

    if (existingState) {
      return existingState;
    }

    const nextState: PendingSummaryState = {
      excludeFromLlmContext: undefined,
      lastFlushedAt: null,
      latestSummary: '',
      timerId: null,
    };
    pendingSummaryStatesRef.current.set(requestId, nextState);
    return nextState;
  }

  function flushStreamingSummaryMessage(requestId: BuilderRequestId, options?: { pending?: boolean }) {
    const pendingSummaryState = pendingSummaryStatesRef.current.get(requestId);

    if (!pendingSummaryState) {
      return;
    }

    const trimmedSummary = pendingSummaryState.latestSummary.trim();
    clearPendingSummaryTimer(pendingSummaryState);

    if (!trimmedSummary) {
      pendingSummaryStatesRef.current.delete(requestId);
      return;
    }

    dispatch(
      builderActions.appendChatMessage({
        content: options?.pending ? formatPendingSummary(trimmedSummary) : trimmedSummary,
        excludeFromLlmContext: pendingSummaryState.excludeFromLlmContext,
        isStreaming: options?.pending ? true : undefined,
        messageKey: getStreamingSummaryMessageKey(requestId),
        role: 'assistant',
      }),
    );
    pendingSummaryState.lastFlushedAt = Date.now();

    if (!options?.pending) {
      pendingSummaryStatesRef.current.delete(requestId);
    }
  }

  function clearStreamingSummaryMessage(requestId: BuilderRequestId) {
    const pendingSummaryState = pendingSummaryStatesRef.current.get(requestId);
    clearPendingSummaryTimer(pendingSummaryState);
    pendingSummaryStatesRef.current.delete(requestId);

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

    const latestPendingSummary = pendingSummaryStatesRef.current.get(requestId)?.latestSummary.trim();

    if (latestPendingSummary) {
      return latestPendingSummary;
    }

    if (pendingSummaryStatesRef.current.has(requestId)) {
      return '';
    }

    const pendingSummaryMessage = store
      .getState()
      .builder.chatMessages.find((message) => message.messageKey === getStreamingSummaryMessageKey(requestId));

    if (!pendingSummaryMessage) {
      return '';
    }

    return normalizeCommittedSummary(pendingSummaryMessage.content);
  }

  function upsertStreamingSummaryMessage(
    requestId: BuilderRequestId,
    summary: string,
    options?: { excludeFromLlmContext?: boolean; pending?: boolean },
  ) {
    const trimmedSummary = summary.trim();

    if (!trimmedSummary) {
      return;
    }

    const pendingSummaryState = getPendingSummaryState(requestId);
    pendingSummaryState.excludeFromLlmContext = options?.pending ? true : options?.excludeFromLlmContext;
    pendingSummaryState.latestSummary = trimmedSummary;

    if (!options?.pending) {
      flushStreamingSummaryMessage(requestId);
      return;
    }

    const now = Date.now();
    const elapsedSinceLastFlush =
      pendingSummaryState.lastFlushedAt === null ? PENDING_SUMMARY_THROTTLE_MS : now - pendingSummaryState.lastFlushedAt;

    if (elapsedSinceLastFlush >= PENDING_SUMMARY_THROTTLE_MS) {
      flushStreamingSummaryMessage(requestId, { pending: true });
      return;
    }

    if (pendingSummaryState.timerId !== null) {
      return;
    }

    pendingSummaryState.timerId = setTimeout(() => {
      flushStreamingSummaryMessage(requestId, { pending: true });
    }, PENDING_SUMMARY_THROTTLE_MS - elapsedSinceLastFlush);
  }

  function upsertStreamingStatusMessage(requestId: BuilderRequestId, status: string) {
    const trimmedStatus = status.trim();

    if (!trimmedStatus) {
      return;
    }

    const pendingSummaryState = getPendingSummaryState(requestId);
    pendingSummaryState.excludeFromLlmContext = true;
    clearPendingSummaryTimer(pendingSummaryState);

    dispatch(
      builderActions.appendChatMessage({
        content: trimmedStatus,
        excludeFromLlmContext: true,
        isStreaming: true,
        messageKey: getStreamingSummaryMessageKey(requestId),
        role: 'assistant',
      }),
    );
    pendingSummaryState.lastFlushedAt = Date.now();
  }

  return {
    clearStreamingSummaryMessage,
    getCommittedSummary,
    upsertStreamingSummaryMessage,
    upsertStreamingStatusMessage,
  };
}
