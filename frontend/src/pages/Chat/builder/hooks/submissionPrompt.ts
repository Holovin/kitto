import type { BuilderRuntimeConfigStatus } from '@pages/Chat/builder/config';

export type BuilderComposerSubmitMode =
  | 'send'
  | 'repeat'
  | 'generating'
  | 'updating'
  | 'config-loading'
  | 'config-unavailable';

interface BuilderComposerSubmitStateOptions {
  configStatus: BuilderRuntimeConfigStatus;
  draftPrompt: string;
  hasCommittedSource: boolean;
  isSubmitting: boolean;
  retryPrompt: string | null;
}

interface ResolveBuilderComposerPromptOptions {
  draftPrompt: string;
  retryPrompt: string | null;
}

function normalizePrompt(prompt: string | null) {
  const trimmedPrompt = prompt?.trim();

  return trimmedPrompt ? trimmedPrompt : null;
}

export function resolveBuilderComposerPrompt({ draftPrompt, retryPrompt }: ResolveBuilderComposerPromptOptions) {
  return normalizePrompt(draftPrompt) ?? normalizePrompt(retryPrompt);
}

export function getBuilderComposerSubmitState({
  configStatus,
  draftPrompt,
  hasCommittedSource,
  isSubmitting,
  retryPrompt,
}: BuilderComposerSubmitStateOptions) {
  let mode: BuilderComposerSubmitMode;

  if (configStatus === 'loading') {
    mode = 'config-loading';
  } else if (configStatus === 'failed') {
    mode = 'config-unavailable';
  } else if (isSubmitting) {
    mode = hasCommittedSource ? 'updating' : 'generating';
  } else if (draftPrompt.length > 0) {
    mode = 'send';
  } else if (normalizePrompt(retryPrompt)) {
    mode = 'repeat';
  } else {
    mode = 'send';
  }

  return {
    disabled: mode === 'config-loading' || mode === 'config-unavailable' || isSubmitting || (!normalizePrompt(draftPrompt) && mode !== 'repeat'),
    label:
      mode === 'config-loading'
        ? 'Loading config...'
        : mode === 'config-unavailable'
          ? 'Send unavailable'
          : mode === 'generating'
        ? 'Generating...'
        : mode === 'updating'
          ? 'Updating...'
          : mode === 'repeat'
            ? 'Repeat'
            : 'Send',
    mode,
  };
}
