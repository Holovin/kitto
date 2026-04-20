import { describe, expect, it } from 'vitest';
import { getBuilderComposerSubmitState, resolveBuilderComposerPrompt } from '@features/builder/hooks/submissionPrompt';

describe('submissionPrompt', () => {
  it('enables Repeat after a failed request when the composer is empty', () => {
    expect(
      getBuilderComposerSubmitState({
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
