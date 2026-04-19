import { describe, expect, it } from 'vitest';
import {
  combinePreviewIssues,
  createRendererCrashIssue,
  mapOpenUiErrorsToIssues,
  shouldResetRuntimeIssues,
} from '@features/builder/openui/runtime/issues';

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

  it('surfaces renderer crash issues in the Definition panel issue list', () => {
    const runtimeIssue = createRendererCrashIssue(
      new Error('boom'),
      'preview-runtime-error',
      'The committed preview crashed while rendering.',
    );

    expect(
      combinePreviewIssues({
        isPreviewEmptyCanvas: false,
        isShowingRejectedDefinition: false,
        parseIssues: [],
        runtimeIssues: [runtimeIssue],
      }),
    ).toEqual([runtimeIssue]);
  });

  it('clears runtime issues after the committed preview source changes', () => {
    expect(
      shouldResetRuntimeIssues({
        nextPreviewSource: 'root = AppShell([])',
        nextRejectedDefinition: false,
        previousPreviewSource: 'root = AppShell([Screen("main", "Main", [])])',
        previousRejectedDefinition: false,
      }),
    ).toBe(true);
  });

  it('keeps rejected definition issues separate from stale runtime issues', () => {
    const parseIssue = {
      code: 'missing-root',
      message: 'Missing root.',
      source: 'parser',
    } as const;
    const runtimeIssue = createRendererCrashIssue(
      new Error('boom'),
      'preview-runtime-error',
      'The committed preview crashed while rendering.',
    );

    expect(
      combinePreviewIssues({
        isPreviewEmptyCanvas: false,
        isShowingRejectedDefinition: true,
        parseIssues: [parseIssue],
        runtimeIssues: [runtimeIssue],
      }),
    ).toEqual([parseIssue]);
  });
});
