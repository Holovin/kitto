import { describe, expect, it } from 'vitest';
import {
  BACKEND_DISCONNECTED_NOTICE,
  BACKEND_RECONNECTED_NOTICE,
  resolveBackendConnectionNotice,
} from '@pages/Chat/builder/components/chatNotices';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@pages/Chat/builder/store/chatMessageKeys';

describe('resolveBackendConnectionNotice', () => {
  it('emits a disconnect notice when health is down and no status message exists yet', () => {
    expect(
      resolveBackendConnectionNotice({
        configStatus: 'loaded',
        isBackendDisconnected: true,
        previouslyUnavailable: null,
        statusContent: null,
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
        configStatus: 'loaded',
        isBackendDisconnected: false,
        previouslyUnavailable: null,
        statusContent: BACKEND_DISCONNECTED_NOTICE,
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
        configStatus: 'loaded',
        isBackendDisconnected: true,
        previouslyUnavailable: true,
        statusContent: BACKEND_DISCONNECTED_NOTICE,
      }),
    ).toBeNull();
  });

  it('re-emits a disconnect notice after chat history was cleared while the backend is still disconnected', () => {
    expect(
      resolveBackendConnectionNotice({
        configStatus: 'loaded',
        isBackendDisconnected: true,
        previouslyUnavailable: true,
        statusContent: null,
      }),
    ).toEqual({
      content: BACKEND_DISCONNECTED_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
      tone: 'error',
    });
  });

  it('uses the backend status message for runtime config failures', () => {
    expect(
      resolveBackendConnectionNotice({
        configStatus: 'failed',
        isBackendDisconnected: false,
        previouslyUnavailable: null,
        statusContent: null,
      }),
    ).toEqual({
      content: BACKEND_DISCONNECTED_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.backendConnectionStatus,
      tone: 'error',
    });
  });

  it('does not emit a chat notice while runtime config is only loading', () => {
    expect(
      resolveBackendConnectionNotice({
        configStatus: 'loading',
        isBackendDisconnected: false,
        previouslyUnavailable: null,
        statusContent: null,
      }),
    ).toBeNull();
  });

  it('does not duplicate the current runtime config failure notice', () => {
    expect(
      resolveBackendConnectionNotice({
        configStatus: 'failed',
        isBackendDisconnected: false,
        previouslyUnavailable: true,
        statusContent: BACKEND_DISCONNECTED_NOTICE,
      }),
    ).toBeNull();
  });
});
