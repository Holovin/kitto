import { describe, expect, it } from 'vitest';
import {
  BACKEND_DISCONNECTED_NOTICE,
  BACKEND_RECONNECTED_NOTICE,
  RUNTIME_CONFIG_UNAVAILABLE_NOTICE,
  resolveBackendConnectionNotice,
  resolveRuntimeConfigNotice,
} from '@features/builder/components/chatNotices';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@features/builder/store/chatMessageKeys';

describe('resolveBackendConnectionNotice', () => {
  it('emits a disconnect notice when health is down and no status message exists yet', () => {
    expect(
      resolveBackendConnectionNotice({
        backendStatusContent: null,
        isBackendDisconnected: true,
        previouslyDisconnected: null,
      }),
    ).toEqual({
      content: BACKEND_DISCONNECTED_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
      tone: 'error',
    });
  });

  it('emits a recovery notice when the current backend status message is stale on reconnect', () => {
    expect(
      resolveBackendConnectionNotice({
        backendStatusContent: BACKEND_DISCONNECTED_NOTICE,
        isBackendDisconnected: false,
        previouslyDisconnected: null,
      }),
    ).toEqual({
      content: BACKEND_RECONNECTED_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
      tone: 'success',
    });
  });

  it('does not emit a duplicate disconnect notice while the backend is still down and the latest status is already current', () => {
    expect(
      resolveBackendConnectionNotice({
        backendStatusContent: BACKEND_DISCONNECTED_NOTICE,
        isBackendDisconnected: true,
        previouslyDisconnected: true,
      }),
    ).toBeNull();
  });

  it('re-emits a disconnect notice after chat history was cleared while the backend is still disconnected', () => {
    expect(
      resolveBackendConnectionNotice({
        backendStatusContent: null,
        isBackendDisconnected: true,
        previouslyDisconnected: true,
      }),
    ).toEqual({
      content: BACKEND_DISCONNECTED_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
      tone: 'error',
    });
  });

  it('emits a keyed red chat notice when runtime config failed', () => {
    expect(
      resolveRuntimeConfigNotice({
        configStatus: 'failed',
        runtimeConfigStatusContent: null,
      }),
    ).toEqual({
      content: RUNTIME_CONFIG_UNAVAILABLE_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.runtimeConfigStatus,
      tone: 'error',
    });
  });

  it('does not emit runtime config chat notices for non-error states', () => {
    expect(
      resolveRuntimeConfigNotice({
        configStatus: 'loading',
        runtimeConfigStatusContent: null,
      }),
    ).toBeNull();
    expect(
      resolveRuntimeConfigNotice({
        configStatus: 'loaded',
        runtimeConfigStatusContent: null,
      }),
    ).toBeNull();
  });

  it('does not duplicate the current runtime config failure notice', () => {
    expect(
      resolveRuntimeConfigNotice({
        configStatus: 'failed',
        runtimeConfigStatusContent: RUNTIME_CONFIG_UNAVAILABLE_NOTICE,
      }),
    ).toBeNull();
  });
});
