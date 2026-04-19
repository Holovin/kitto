import { describe, expect, it } from 'vitest';
import { createRendererCrashIssue, mapOpenUiErrorsToIssues } from '@features/builder/openui/runtime/issues';

describe('runtime issue helpers', () => {
  it('maps resolved OpenUI errors to an empty runtime issue list', () => {
    expect(mapOpenUiErrorsToIssues([])).toEqual([]);
  });

  it('creates renderer crash issues with runtime metadata and the error message', () => {
    expect(createRendererCrashIssue(new Error('boom'), 'preview-runtime-error', 'The committed preview crashed while rendering.')).toEqual({
      code: 'preview-runtime-error',
      message: 'The committed preview crashed while rendering. Details: boom',
      source: 'runtime',
    });
  });

  it('falls back to an unknown runtime error message when the thrown value is not an Error', () => {
    expect(createRendererCrashIssue('boom', 'sandbox-runtime-error', 'The element sandbox crashed while rendering.')).toEqual({
      code: 'sandbox-runtime-error',
      message: 'The element sandbox crashed while rendering. Details: Unknown runtime error.',
      source: 'runtime',
    });
  });
});
