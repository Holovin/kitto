import { SYSTEM_CHAT_MESSAGE_KEYS } from '@pages/Chat/builder/store/chatMessageKeys';
import type { BuilderRuntimeConfigStatus } from '@pages/Chat/builder/config';
import type { BuilderChatNotice } from '@pages/Chat/builder/types';

export const BACKEND_DISCONNECTED_NOTICE =
  'Backend is disconnected. You can still inspect the last persisted definition, but new prompts will fail until /api/health recovers.';
export const BACKEND_RECONNECTED_NOTICE = 'Backend connection recovered. New prompts are available again.';
export const RUNTIME_CONFIG_UNAVAILABLE_NOTICE =
  'Runtime config is unavailable. Chat send is disabled until /api/config can be loaded.';
export const RUNTIME_CONFIG_LOADING_NOTICE =
  'Runtime config is still loading. Chat send will unlock after /api/config is ready.';

interface ResolveBackendConnectionNoticeOptions {
  backendStatusContent: string | null;
  isBackendDisconnected: boolean;
  previouslyDisconnected: boolean | null;
}

interface ResolveRuntimeConfigNoticeOptions {
  configStatus: BuilderRuntimeConfigStatus;
  runtimeConfigStatusContent: string | null;
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

export function resolveRuntimeConfigNotice({
  configStatus,
  runtimeConfigStatusContent,
}: ResolveRuntimeConfigNoticeOptions): BuilderChatNotice | null {
  if (configStatus === 'loading') {
    if (runtimeConfigStatusContent === RUNTIME_CONFIG_LOADING_NOTICE) {
      return null;
    }

    return {
      content: RUNTIME_CONFIG_LOADING_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.runtimeConfigStatus,
      tone: 'info',
    };
  }

  if (configStatus !== 'failed') {
    return null;
  }

  if (runtimeConfigStatusContent === RUNTIME_CONFIG_UNAVAILABLE_NOTICE) {
    return null;
  }

  return {
    content: RUNTIME_CONFIG_UNAVAILABLE_NOTICE,
    messageKey: SYSTEM_CHAT_MESSAGE_KEYS.runtimeConfigStatus,
    tone: 'error',
  };
}
