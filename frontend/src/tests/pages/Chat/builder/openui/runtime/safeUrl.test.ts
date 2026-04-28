import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSafeUrl, parseSafeSourceUrlLiteral, parseSafeUrl } from '@pages/Chat/builder/openui/runtime/safeUrl';
import {
  allowedUrlCases,
  fileRuntimeRejectedUrlCases,
  rejectedUrlCases,
} from '@src/tests/pages/Chat/builder/openui/runtime/safeUrlTestCases';

describe('safeUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('parseSafeUrl', () => {
    it.each(allowedUrlCases)('allows $label', ({ value }) => {
      expect(parseSafeUrl(value)).toBe(value);
    });

    it.each(rejectedUrlCases)('rejects $label', ({ value }) => {
      expect(parseSafeUrl(value)).toBeNull();
    });

    it.each(fileRuntimeRejectedUrlCases)('rejects $label', ({ value }) => {
      vi.stubGlobal('location', { protocol: 'file:' });

      expect(parseSafeUrl(value)).toBeNull();
    });

    it.each(fileRuntimeRejectedUrlCases)('rejects $label for source-level validation too', ({ value }) => {
      vi.stubGlobal('location', { protocol: 'file:' });

      expect(parseSafeSourceUrlLiteral(value)).toBeNull();
    });
  });

  describe('openSafeUrl', () => {
    it.each(allowedUrlCases)('opens $label without throwing', ({ value }) => {
      const open = vi.fn();
      let result = false;

      expect(() => {
        result = openSafeUrl(value, open);
      }).not.toThrow();
      expect(result).toBe(true);
      expect(open).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledWith(value as string);
    });

    it.each(rejectedUrlCases)('does not throw or open $label', ({ value }) => {
      const open = vi.fn();
      let result = true;

      expect(() => {
        result = openSafeUrl(value, open);
      }).not.toThrow();
      expect(result).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });

    it.each(fileRuntimeRejectedUrlCases)('does not open $label', ({ value }) => {
      const open = vi.fn();
      let result = true;

      vi.stubGlobal('location', { protocol: 'file:' });

      expect(() => {
        result = openSafeUrl(value, open);
      }).not.toThrow();
      expect(result).toBe(false);
      expect(open).not.toHaveBeenCalled();
    });
  });
});
