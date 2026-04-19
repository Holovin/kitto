import { BuiltinActionType, type ActionEvent } from '@openuidev/react-lang';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleOpenUiActionEvent } from '@features/builder/openui/runtime/actionEvents';

function createOpenUrlEvent(url: unknown): ActionEvent {
  return {
    type: BuiltinActionType.OpenUrl,
    params: { url },
    humanFriendlyMessage: '',
    formState: {},
    formName: undefined,
  };
}

describe('handleOpenUiActionEvent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects unsafe URLs', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    expect(handleOpenUiActionEvent(createOpenUrlEvent('javascript:alert(1)'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens safe relative URLs', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    expect(handleOpenUiActionEvent(createOpenUrlEvent('/chat'))).toBe(true);
    expect(open).toHaveBeenCalledWith('/chat', '_blank', 'noopener,noreferrer');
  });

  it('does not throw on invalid URLs', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    expect(() => handleOpenUiActionEvent(createOpenUrlEvent('http://exa mple.com'))).not.toThrow();
    expect(handleOpenUiActionEvent(createOpenUrlEvent('http://exa mple.com'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
