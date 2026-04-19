import { Sparkles } from 'lucide-react';
import { Button } from '@components/ui/button';
import { BUILDER_DEMO_PRESETS } from '@features/builder/openui/runtime/demos';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { useAppDispatch } from '@store/hooks';

const EMPTY_PREVIEW_PROMPTS = [
  {
    label: 'Todo list',
    prompt: 'Build a todo list with add, complete, and filter controls.',
  },
  {
    label: 'Quiz app',
    prompt: 'Create a three-screen quiz app with intro, one question, and result screen.',
  },
  {
    label: 'Signup form',
    prompt: 'Create a signup form with name, email, and a required agreement checkbox.',
  },
] as const;

const EMPTY_PREVIEW_DEMOS = [
  { label: 'Todo list', presetId: 'todo-demo' },
  { label: 'Quiz with 3 questions', presetId: 'quiz-demo' },
] as const;

export function PreviewEmptyState() {
  const dispatch = useAppDispatch();

  function handleInsertPrompt(prompt: string) {
    dispatch(builderActions.setDraftPrompt(prompt));
  }

  function handleLoadSuggestion(presetId: string) {
    const demoPreset = BUILDER_DEMO_PRESETS.find((preset) => preset.id === presetId);

    if (!demoPreset) {
      return;
    }

    const nextDomainData = structuredClone(demoPreset.domainData);
    const snapshot = createBuilderSnapshot(demoPreset.source, {}, nextDomainData);
    dispatch(domainActions.replaceData(nextDomainData));
    dispatch(builderSessionActions.replaceRuntimeSessionState(snapshot.runtimeState));
    dispatch(
      builderActions.applyDemoDefinition({
        label: demoPreset.label,
        snapshot,
      }),
    );
  }

  return (
    <div className="flex min-h-[36rem] flex-col items-center justify-center gap-8 text-center">
      <div className="space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-slate-700">
          <Sparkles className="h-7 w-7" />
        </div>
        <h3 className="text-3xl font-semibold tracking-tight text-slate-950">Preview is empty</h3>
      </div>

      <div className="h-px w-full max-w-md bg-slate-200/80" />

      <div className="flex flex-col items-center gap-4">
        <p className="text-sm font-medium text-slate-500">Try these prompts:</p>
        <div className="flex max-w-4xl flex-wrap items-center justify-center gap-3">
          {EMPTY_PREVIEW_PROMPTS.map((suggestion) => (
            <Button key={suggestion.label} size="lg" variant="secondary" onClick={() => handleInsertPrompt(suggestion.prompt)}>
              {suggestion.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="h-px w-full max-w-md bg-slate-200/80" />

      <div className="flex flex-col items-center gap-4">
        <p className="text-sm font-medium text-slate-500">Or import a generated app</p>
        <div className="flex max-w-4xl flex-wrap items-center justify-center gap-3">
          {EMPTY_PREVIEW_DEMOS.map((suggestion) => (
            <Button
              key={suggestion.label}
              size="lg"
              variant="secondary"
              onClick={() => handleLoadSuggestion(suggestion.presetId)}
            >
              {suggestion.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
