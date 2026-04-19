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

  it('opens safe https URLs', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    expect(handleOpenUiActionEvent(createOpenUrlEvent('https://example.com/docs'))).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
  });

  it('does not throw on invalid URLs', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    expect(() => handleOpenUiActionEvent(createOpenUrlEvent('http://exa mple.com'))).not.toThrow();
    expect(handleOpenUiActionEvent(createOpenUrlEvent('http://exa mple.com'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects unsafe data URLs without throwing', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    expect(() => handleOpenUiActionEvent(createOpenUrlEvent('data:text/html,<script>alert(1)</script>'))).not.toThrow();
    expect(handleOpenUiActionEvent(createOpenUrlEvent('data:text/html,<script>alert(1)</script>'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects blob URLs without throwing', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    expect(() => handleOpenUiActionEvent(createOpenUrlEvent('blob:https://example.com/123'))).not.toThrow();
    expect(handleOpenUiActionEvent(createOpenUrlEvent('blob:https://example.com/123'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
