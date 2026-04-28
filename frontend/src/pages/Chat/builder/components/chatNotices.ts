import { SYSTEM_CHAT_MESSAGE_KEYS } from '@pages/Chat/builder/store/chatMessageKeys';
import type { BuilderRuntimeConfigStatus } from '@pages/Chat/builder/config';
import type { BuilderChatNotice } from '@pages/Chat/builder/types';

export const BACKEND_DISCONNECTED_NOTICE =
  'Backend services are unavailable. Chat send is disabled until /api/health and /api/config recover.';
export const BACKEND_RECONNECTED_NOTICE = 'Backend connection recovered. New prompts are available again.';
export const RUNTIME_CONFIG_UNAVAILABLE_NOTICE =
  'Runtime config is unavailable. Chat send is disabled until /api/config can be loaded.';
export const RUNTIME_CONFIG_LOADING_NOTICE =
  'Runtime config is still loading. Chat send will unlock after /api/config is ready.';

interface ResolveBackendConnectionNoticeOptions {
  statusContent: string | null;
  configStatus: BuilderRuntimeConfigStatus;
  isBackendDisconnected: boolean;
  previouslyUnavailable: boolean | null;
}

export function resolveBackendConnectionNotice({
  statusContent,
  configStatus,
  isBackendDisconnected,
  previouslyUnavailable,
}: ResolveBackendConnectionNoticeOptions): BuilderChatNotice | null {
  const isUnavailable = isBackendDisconnected || configStatus === 'failed';
  const isReady = !isBackendDisconnected && configStatus === 'loaded';

  if (isUnavailable) {
    if (
      statusContent === null ||
      statusContent !== BACKEND_DISCONNECTED_NOTICE ||
      previouslyUnavailable === false
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
    isReady &&
    (previouslyUnavailable === true ||
      (statusContent !== null && statusContent !== BACKEND_RECONNECTED_NOTICE))
  ) {
    return {
      content: BACKEND_RECONNECTED_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
      tone: 'success',
    };
  }

  return null;
}
