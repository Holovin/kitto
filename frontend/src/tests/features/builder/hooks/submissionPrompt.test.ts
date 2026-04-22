import { describe, expect, it } from 'vitest';
import { getBuilderComposerSubmitState, resolveBuilderComposerPrompt } from '@features/builder/hooks/submissionPrompt';

describe('submissionPrompt', () => {
  it('enables Repeat after a failed request when the composer is empty', () => {
    expect(
      getBuilderComposerSubmitState({
        configStatus: 'loaded',
        draftPrompt: '',
        hasCommittedSource: true,
        isSubmitting: false,
        retryPrompt: 'Retry the last request',
      }),
    ).toEqual({
      disabled: false,
      label: 'Repeat',
      mode: 'repeat',
    });
  });

  it('switches back to Send as soon as the user types a new prompt', () => {
    expect(
      getBuilderComposerSubmitState({
        configStatus: 'loaded',
        draftPrompt: ' ',
        hasCommittedSource: true,
        isSubmitting: false,
        retryPrompt: 'Retry the last request',
      }),
    ).toEqual({
      disabled: true,
      label: 'Send',
      mode: 'send',
    });
  });

  it('shows the in-flight generation labels while submitting', () => {
    expect(
      getBuilderComposerSubmitState({
        configStatus: 'loaded',
        draftPrompt: '',
        hasCommittedSource: false,
        isSubmitting: true,
        retryPrompt: 'Retry the last request',
      }),
    ).toEqual({
      disabled: true,
      label: 'Generating...',
      mode: 'generating',
    });

    expect(
      getBuilderComposerSubmitState({
        configStatus: 'loaded',
        draftPrompt: '',
        hasCommittedSource: true,
        isSubmitting: true,
        retryPrompt: 'Retry the last request',
      }),
    ).toEqual({
      disabled: true,
      label: 'Updating...',
      mode: 'updating',
    });
  });

  it('keeps the submit action disabled while runtime config is loading', () => {
    expect(
      getBuilderComposerSubmitState({
        configStatus: 'loading',
        draftPrompt: 'Ship a new version',
        hasCommittedSource: true,
        isSubmitting: false,
        retryPrompt: null,
      }),
    ).toEqual({
      disabled: true,
      label: 'Loading config...',
      mode: 'config-loading',
    });
  });

  it('keeps the submit action disabled when runtime config failed to load', () => {
    expect(
      getBuilderComposerSubmitState({
        configStatus: 'failed',
        draftPrompt: 'Ship a new version',
        hasCommittedSource: true,
        isSubmitting: false,
        retryPrompt: null,
      }),
    ).toEqual({
      disabled: true,
      label: 'Send unavailable',
      mode: 'config-unavailable',
    });
  });

  it('resolves the retry prompt only when the composer has no new text', () => {
    expect(
      resolveBuilderComposerPrompt({
        draftPrompt: '',
        retryPrompt: 'Retry the last request',
      }),
    ).toBe('Retry the last request');

    expect(
      resolveBuilderComposerPrompt({
        draftPrompt: 'Ship a new version',
        retryPrompt: 'Retry the last request',
      }),
    ).toBe('Ship a new version');

    expect(
      resolveBuilderComposerPrompt({
        draftPrompt: '',
        retryPrompt: null,
      }),
    ).toBeNull();
  });
});
