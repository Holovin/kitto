import { Sparkles } from 'lucide-react';
import { Button } from '@components/ui/button';
import { BUILDER_DEMO_PRESETS } from '@features/builder/openui/runtime/demos';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { useAppDispatch } from '@store/hooks';

const EMPTY_PREVIEW_SUGGESTIONS = [
  { label: 'Create a todo list', presetId: 'todo-demo' },
  { label: 'Add due dates', presetId: 'todo-demo' },
  { label: 'Allow filtering by completed', presetId: 'todo-demo' },
  { label: 'Create a quiz with 3 questions', presetId: 'quiz-demo' },
  { label: 'Show result screen after the last question', presetId: 'quiz-demo' },
  { label: 'Add a checkbox agreement step before submit', presetId: 'agreement-demo' },
] as const;

export function PreviewEmptyState() {
  const dispatch = useAppDispatch();

  function handleLoadSuggestion(label: string, presetId: string) {
    dispatch(builderActions.setDraftPrompt(label));
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

      <div className="flex max-w-4xl flex-wrap items-center justify-center gap-3">
        {EMPTY_PREVIEW_SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion.label}
            size="lg"
            variant="secondary"
            onClick={() => handleLoadSuggestion(suggestion.label, suggestion.presetId)}
          >
            {suggestion.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
