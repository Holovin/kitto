import { BuiltinActionType, type ActionEvent } from '@openuidev/react-lang';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleOpenUiActionEvent } from '@features/builder/openui/runtime/actionEvents';
import { parseSafeUrl } from '@features/builder/openui/runtime/safeUrl';
import {
  allowedUrlCases,
  fileRuntimeRejectedUrlCases,
  rejectedUrlCases,
} from '@src/tests/features/builder/openui/runtime/safeUrlTestCases';

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

  it.each([...allowedUrlCases, ...rejectedUrlCases])(
    'uses parseSafeUrl to decide whether $label can open',
    ({ value }) => {
      const open = vi.fn();
      const expectedSafeUrl = parseSafeUrl(value);
      let result = false;

      vi.stubGlobal('window', { open });

      expect(() => {
        result = handleOpenUiActionEvent(createOpenUrlEvent(value));
      }).not.toThrow();
      expect(result).toBe(expectedSafeUrl !== null);

      if (expectedSafeUrl) {
        expect(open).toHaveBeenCalledWith(expectedSafeUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      expect(open).not.toHaveBeenCalled();
    },
  );

  it.each(fileRuntimeRejectedUrlCases)(
    'rejects $label when parseSafeUrl blocks file runtime navigation',
    ({ value }) => {
      const open = vi.fn();
      let result = true;

      vi.stubGlobal('window', { open });
      vi.stubGlobal('location', { protocol: 'file:' });

      expect(() => {
        result = handleOpenUiActionEvent(createOpenUrlEvent(value));
      }).not.toThrow();
      expect(result).toBe(false);
      expect(open).not.toHaveBeenCalled();
    },
  );

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

  it('rejects relative app URLs when running from file protocol', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    vi.stubGlobal('location', { protocol: 'file:' });

    expect(handleOpenUiActionEvent(createOpenUrlEvent('/chat'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects hash URLs when running from file protocol', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    vi.stubGlobal('location', { protocol: 'file:' });

    expect(handleOpenUiActionEvent(createOpenUrlEvent('#section'))).toBe(false);
    expect(open).not.toHaveBeenCalled();
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
