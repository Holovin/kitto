import { SYSTEM_CHAT_MESSAGE_KEYS } from '@features/builder/store/chatMessageKeys';
import type { BuilderChatNotice } from '@features/builder/types';

export const BACKEND_DISCONNECTED_NOTICE =
  'Backend is disconnected. You can still inspect the last persisted definition, but new prompts will fail until /api/health recovers.';
export const BACKEND_RECONNECTED_NOTICE = 'Backend connection recovered. New prompts are available again.';

interface ResolveBackendConnectionNoticeOptions {
  backendStatusContent: string | null;
  isBackendDisconnected: boolean;
  previouslyDisconnected: boolean | null;
}

export function resolveBackendConnectionNotice({
  backendStatusContent,
  isBackendDisconnected,
  previouslyDisconnected,
}: ResolveBackendConnectionNoticeOptions): BuilderChatNotice | null {
  if (isBackendDisconnected) {
    if (
      backendStatusContent === null ||
      backendStatusContent !== BACKEND_DISCONNECTED_NOTICE ||
      previouslyDisconnected === false
    ) {
      return {
        content: BACKEND_DISCONNECTED_NOTICE,
        messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
        tone: 'error',
      };
    }

    return null;
  }

  if (
    previouslyDisconnected === true ||
    (backendStatusContent !== null && backendStatusContent !== BACKEND_RECONNECTED_NOTICE)
  ) {
    return {
      content: BACKEND_RECONNECTED_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
      tone: 'success',
    };
  }

  return null;
}
