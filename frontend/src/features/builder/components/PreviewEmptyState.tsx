import { BadgePlus, Brain, ClipboardList, Fish, FolderOpen, MessageSquarePlus, Sparkles, Target, type LucideIcon } from 'lucide-react';
import { Button } from '@components/ui/button';
import { BUILDER_DEMO_PRESETS } from '@features/builder/openui/runtime/demos';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { builderActions } from '@features/builder/store/builderSlice';
import { builderSessionActions } from '@features/builder/store/builderSessionSlice';
import { domainActions } from '@features/builder/store/domainSlice';
import { cn } from '@lib/utils';
import { useAppDispatch } from '@store/hooks';

interface PreviewSuggestionDecoration {
  gradientClassName: string;
  gradientFrameClassName: string;
  iconFrameClassName: string;
  iconScale: number;
  iconSizeRem: number;
}

const QUIZ_APP_DECORATION_LAYOUT = {
  gradientFrameClassName: 'right-[-1.85rem] bottom-[-2.2rem] h-28 w-28 rounded-[2.8rem]',
  iconFrameClassName: 'right-[-0.95rem] bottom-[-0.85rem]',
  iconScale: 1.3,
  iconSizeRem: 3.55,
} as const;

const QUIZ_APP_GRADIENT_CLASS_NAME =
  'bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(239,246,255,0.5)_46%,rgba(191,219,254,0.32)_100%)]';
const DEMO_GRADIENT_CLASS_NAME =
  'bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(245,243,255,0.5)_46%,rgba(221,214,254,0.32)_100%)]';

const EMPTY_PREVIEW_PROMPTS = [
  {
    decoration: {
      ...QUIZ_APP_DECORATION_LAYOUT,
      gradientClassName: QUIZ_APP_GRADIENT_CLASS_NAME,
    },
    icon: ClipboardList,
    label: 'Todo list',
    prompt: 'Build a todo list with add, complete, and filter controls.',
  },
  {
    decoration: {
      ...QUIZ_APP_DECORATION_LAYOUT,
      gradientClassName: QUIZ_APP_GRADIENT_CLASS_NAME,
    },
    icon: Brain,
    label: 'Quiz app',
    prompt: 'Create a three-screen quiz app with intro, one question, and result screen.',
  },
  {
    decoration: {
      ...QUIZ_APP_DECORATION_LAYOUT,
      gradientClassName: QUIZ_APP_GRADIENT_CLASS_NAME,
    },
    icon: BadgePlus,
    label: 'Signup form',
    prompt: 'Create a signup form with name, email, and a required agreement checkbox.',
  },
] as const;

const EMPTY_PREVIEW_DEMOS = [
  {
    decoration: {
      ...QUIZ_APP_DECORATION_LAYOUT,
      gradientClassName: DEMO_GRADIENT_CLASS_NAME,
    },
    icon: Fish,
    label: 'Animal explorer',
    presetId: 'animal-explorer-demo',
  },
  {
    decoration: {
      ...QUIZ_APP_DECORATION_LAYOUT,
      gradientClassName: DEMO_GRADIENT_CLASS_NAME,
    },
    icon: ClipboardList,
    label: 'Todo list',
    presetId: 'todo-demo',
  },
  {
    decoration: {
      ...QUIZ_APP_DECORATION_LAYOUT,
      gradientClassName: DEMO_GRADIENT_CLASS_NAME,
    },
    icon: Target,
    label: 'Quiz with 3 questions',
    presetId: 'quiz-demo',
  },
] as const;

const promptCardClassName =
  'relative h-[6.5rem] w-[8.75rem] shrink-0 overflow-hidden flex-col items-start justify-between rounded-[1.25rem] border-slate-200/90 px-4 py-3 text-left text-[0.92rem] leading-5 whitespace-normal shadow-none bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(239,246,255,0.96)_100%)] hover:bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(235,245,255,0.98)_100%)] hover:shadow-none';
const demoCardClassName =
  'relative h-[6.5rem] w-[8.75rem] shrink-0 overflow-hidden flex-col items-start justify-between rounded-[1.25rem] border-slate-200/90 px-4 py-3 text-left text-[0.92rem] leading-5 whitespace-normal shadow-none bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(245,243,255,0.96)_100%)] hover:bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(241,238,255,0.98)_100%)] hover:shadow-none';

interface PreviewSuggestionCardProps {
  cardType: 'Demo' | 'Prompt';
  className: string;
  decoration: PreviewSuggestionDecoration;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

function PreviewSuggestionCard({
  cardType,
  className,
  decoration,
  icon: Icon,
  label,
  onClick,
}: PreviewSuggestionCardProps) {
  const iconColor = cardType === 'Prompt' ? 'rgb(186 230 253 / 0.55)' : 'rgb(221 214 254 / 0.55)';

  return (
    <Button className={cn('group', className)} size="lg" variant="secondary" onClick={onClick}>
      <span
        aria-hidden="true"
        className={cn('pointer-events-none absolute opacity-90', decoration.gradientFrameClassName, decoration.gradientClassName)}
        data-preview-card-gradient={cardType.toLowerCase()}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute z-[1] blur-[2px] transition-[filter] duration-150 ease-out group-hover:blur-none group-focus-visible:blur-none',
          decoration.iconFrameClassName,
        )}
        data-preview-card-icon={cardType.toLowerCase()}
        style={{
          color: iconColor,
          height: `${decoration.iconSizeRem}rem`,
          width: `${decoration.iconSizeRem}rem`,
        }}
      >
        <Icon
          strokeWidth={1.5}
          style={{
            color: 'inherit',
            height: '100%',
            transform: `scale(${decoration.iconScale})`,
            width: '100%',
          }}
        />
      </span>
      <span className="relative z-10 text-[0.7rem] font-medium uppercase tracking-[0.18em] text-slate-400">
        {cardType}
      </span>
      <span className="relative z-10 max-w-[6.2rem] whitespace-normal text-balance">
        {label}
      </span>
    </Button>
  );
}

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

      <div aria-hidden="true" className="h-px w-full max-w-md bg-transparent" />

      <div className="flex flex-col items-center gap-4">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-500">
          <MessageSquarePlus className="h-4 w-4" />
          Try these prompts
        </p>
        <div className="flex max-w-4xl flex-wrap items-center justify-center gap-3">
          {EMPTY_PREVIEW_PROMPTS.map((suggestion) => (
            <PreviewSuggestionCard
              key={suggestion.label}
              cardType="Prompt"
              className={promptCardClassName}
              decoration={suggestion.decoration}
              icon={suggestion.icon}
              label={suggestion.label}
              onClick={() => handleInsertPrompt(suggestion.prompt)}
            />
          ))}
        </div>
      </div>

      <div className="h-px w-full max-w-md bg-slate-200/80" />

      <div className="flex flex-col items-center gap-4">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-500">
          <FolderOpen className="h-4 w-4" />
          Or load an already generated app
        </p>
        <div className="flex max-w-4xl flex-wrap items-center justify-center gap-3">
          {EMPTY_PREVIEW_DEMOS.map((suggestion) => (
            <PreviewSuggestionCard
              key={suggestion.label}
              cardType="Demo"
              className={demoCardClassName}
              decoration={suggestion.decoration}
              icon={suggestion.icon}
              label={suggestion.label}
              onClick={() => handleLoadSuggestion(suggestion.presetId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
