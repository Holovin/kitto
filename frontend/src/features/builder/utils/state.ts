import { validateSpec, type Spec } from '@json-render/core';
import { builderCatalog } from '../jsonui/catalog';

export type BuilderRuntimeState = {
  ui: {
    currentScreen: string | null;
    filter: string;
    layout: string;
    [key: string]: unknown;
  };
  form: Record<string, unknown>;
  data: Record<string, unknown>;
  local: Record<string, unknown>;
  [key: string]: unknown;
};

export type BuilderMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

export type BuilderSnapshot = {
  spec: Spec | null;
  runtimeState: BuilderRuntimeState;
  prompt: string;
  createdAt: string;
};

export type BuilderExportPayload = {
  version: 1;
  exportedAt: string;
  spec: Spec;
  runtimeState: BuilderRuntimeState;
};

export type BuilderDemoPresetDefinition = {
  id: string;
  title: string;
  description: string;
  loadMessage: string;
  build: () => {
    spec: Spec;
    runtimeState: BuilderRuntimeState;
  };
};

function deepMergeObjects<T>(base: T, patch: unknown): T {
  if (Array.isArray(base) || Array.isArray(patch) || typeof base !== 'object' || base === null || typeof patch !== 'object' || patch === null) {
    return (patch as T) ?? base;
  }

  const next = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = next[key];
    next[key] = key in next ? deepMergeObjects(current, value) : value;
  }

  return next as T;
}

export function cloneSpec(spec: Spec | null) {
  return spec ? structuredClone(spec) : null;
}

export function cloneRuntimeState(runtimeState: BuilderRuntimeState) {
  return structuredClone(runtimeState);
}

export function buildEmptyRuntimeState(): BuilderRuntimeState {
  return {
    ui: {
      currentScreen: null,
      filter: 'all',
      layout: 'stacked',
    },
    form: {},
    data: {},
    local: {},
  };
}

export function buildDefaultRuntimeState(): BuilderRuntimeState {
  return {
    ui: {
      currentScreen: 'main',
      filter: 'all',
      layout: 'stacked',
    },
    form: {
      newTodo: '',
    },
    data: {
      todos: [
        {
          id: 'todo-1',
          title: 'Wire the backend health check',
          completed: true,
          note: 'Status badge and boot loader use this signal.',
        },
        {
          id: 'todo-2',
          title: 'Stream JSON patches into the preview',
          completed: false,
          note: 'The Definition tab should update while the preview rerenders.',
        },
      ],
    },
    local: {},
  };
}

export function buildDefaultSpec(): Spec {
  return {
    root: 'app-root',
    elements: {
      'app-root': {
        type: 'AppShell',
        props: {
          title: 'Todo builder demo',
          description: 'This hand-written starter spec shows collections, local state, filtering, conditional rendering, and navigation.',
        },
        children: ['screen-main', 'screen-summary'],
      },
      'screen-main': {
        type: 'Screen',
        props: {
          screenId: 'main',
          title: 'Main screen',
          description: 'Use the chat on the left to reshape this app.',
        },
        children: ['main-stack'],
      },
      'main-stack': {
        type: 'Group',
        props: {
          direction: 'vertical',
          gap: 'lg',
          align: 'stretch',
          className: 'w-full',
        },
        children: ['summary-copy', 'composer-row', 'controls-row', 'todo-list', 'empty-copy', 'footer-row'],
      },
      'summary-copy': {
        type: 'Text',
        props: {
          text: {
            $computed: 'todo_summary',
            args: {
              items: { $state: '/data/todos' },
              filter: { $state: '/ui/filter' },
            },
          },
          variant: 'muted',
        },
        children: [],
      },
      'composer-row': {
        type: 'Group',
        props: {
          direction: 'horizontal',
          gap: 'md',
          align: 'end',
          className: 'w-full',
        },
        children: ['new-task-input', 'add-task-button'],
      },
      'new-task-input': {
        type: 'Input',
        props: {
          label: 'New task',
          name: 'newTask',
          type: 'text',
          placeholder: 'Add a task to the preview',
          value: { $bindState: '/form/newTodo' },
          checks: null,
          validateOn: 'blur',
        },
        children: [],
      },
      'add-task-button': {
        type: 'Button',
        props: {
          label: 'Add item',
          variant: 'primary',
          disabled: false,
        },
        on: {
          press: [
            {
              action: 'append_state',
              params: {
                path: '/data/todos',
                value: {
                  title: { $state: '/form/newTodo' },
                  completed: false,
                  note: '',
                },
              },
            },
            {
              action: 'write_state',
              params: {
                path: '/form/newTodo',
                value: '',
              },
            },
          ],
        },
        children: [],
      },
      'controls-row': {
        type: 'Group',
        props: {
          direction: 'horizontal',
          gap: 'md',
          align: 'start',
          className: 'grid grid-cols-1 md:grid-cols-2',
        },
        children: ['filter-select', 'layout-radios'],
      },
      'filter-select': {
        type: 'Select',
        props: {
          label: 'Filter',
          name: 'filter',
          options: ['all', 'active', 'completed'],
          placeholder: 'Choose a filter',
          value: { $bindState: '/ui/filter' },
          checks: null,
          validateOn: 'change',
        },
        children: [],
      },
      'layout-radios': {
        type: 'RadioGroup',
        props: {
          label: 'Layout',
          name: 'layout',
          options: ['stacked', 'compact'],
          value: { $bindState: '/ui/layout' },
          checks: null,
          validateOn: 'change',
        },
        children: [],
      },
      'todo-list': {
        type: 'Repeater',
        props: {
          emptyText: null,
          className: null,
        },
        repeat: {
          statePath: '/data/todos',
        },
        children: ['todo-row'],
      },
      'todo-row': {
        type: 'Group',
        props: {
          direction: {
            $cond: { $state: '/ui/layout', eq: 'compact' },
            $then: 'horizontal',
            $else: 'vertical',
          },
          gap: 'md',
          align: 'stretch',
          className: 'rounded-[1.25rem] border border-border/70 bg-background/80 p-4',
        },
        visible: {
          $or: [
            { $state: '/ui/filter', eq: 'all' },
            {
              $and: [
                { $state: '/ui/filter', eq: 'active' },
                { $item: 'completed', not: true },
              ],
            },
            {
              $and: [
                { $state: '/ui/filter', eq: 'completed' },
                { $item: 'completed' },
              ],
            },
          ],
        },
        children: ['todo-main', 'todo-remove'],
      },
      'todo-main': {
        type: 'Group',
        props: {
          direction: 'vertical',
          gap: 'sm',
          align: 'stretch',
          className: 'flex-1',
        },
        children: ['todo-checkbox', 'todo-title', 'todo-note'],
      },
      'todo-checkbox': {
        type: 'Checkbox',
        props: {
          label: 'Completed',
          name: 'completed',
          checked: { $bindItem: 'completed' },
          checks: null,
          validateOn: 'change',
        },
        children: [],
      },
      'todo-title': {
        type: 'Text',
        props: {
          text: { $template: '${title}' },
          variant: {
            $cond: { $item: 'completed' },
            $then: 'caption',
            $else: 'body',
          },
        },
        children: [],
      },
      'todo-note': {
        type: 'TextArea',
        props: {
          label: 'Notes',
          name: 'note',
          placeholder: 'Optional detail for this item',
          rows: 2,
          value: { $bindItem: 'note' },
          checks: null,
          validateOn: 'blur',
        },
        children: [],
      },
      'todo-remove': {
        type: 'Button',
        props: {
          label: 'Remove',
          variant: 'danger',
          disabled: false,
        },
        on: {
          press: {
            action: 'remove_state',
            params: {
              path: '/data/todos',
              index: { $index: true },
            },
          },
        },
        children: [],
      },
      'empty-copy': {
        type: 'Text',
        props: {
          text: 'No items match the current filter yet.',
          variant: 'caption',
        },
        visible: {
          $state: '/data/todos/0',
          not: true,
        },
        children: [],
      },
      'footer-row': {
        type: 'Group',
        props: {
          direction: 'horizontal',
          gap: 'md',
          align: 'center',
          className: 'flex-wrap',
        },
        children: ['docs-link', 'summary-button'],
      },
      'docs-link': {
        type: 'Link',
        props: {
          label: 'Open json-render docs',
          href: 'https://json-render.dev',
        },
        on: {
          click: {
            action: 'open_url',
            params: {
              url: 'https://json-render.dev',
            },
            preventDefault: true,
          },
        },
        children: [],
      },
      'summary-button': {
        type: 'Button',
        props: {
          label: 'Show summary screen',
          variant: 'secondary',
          disabled: false,
        },
        on: {
          press: {
            action: 'navigate_screen',
            params: {
              screenId: 'summary',
            },
          },
        },
        children: [],
      },
      'screen-summary': {
        type: 'Screen',
        props: {
          screenId: 'summary',
          title: 'Summary screen',
          description: 'A second screen proves that generated apps can navigate in-browser.',
        },
        children: ['summary-stack'],
      },
      'summary-stack': {
        type: 'Group',
        props: {
          direction: 'vertical',
          gap: 'lg',
          align: 'stretch',
          className: 'max-w-2xl',
        },
        children: ['summary-text', 'summary-back'],
      },
      'summary-text': {
        type: 'Text',
        props: {
          text: {
            $computed: 'summary_detail',
            args: {
              items: { $state: '/data/todos' },
            },
          },
          variant: 'lead',
        },
        children: [],
      },
      'summary-back': {
        type: 'Button',
        props: {
          label: 'Back to main screen',
          variant: 'primary',
          disabled: false,
        },
        on: {
          press: {
            action: 'navigate_screen',
            params: {
              screenId: 'main',
            },
          },
        },
        children: [],
      },
    },
  };
}

export function buildQuizDemoRuntimeState(): BuilderRuntimeState {
  return {
    ...buildEmptyRuntimeState(),
    ui: {
      ...buildEmptyRuntimeState().ui,
      currentScreen: 'quiz',
    },
    quiz: {
      answer: '',
      isCorrect: false,
    },
  };
}

export function buildQuizDemoSpec(): Spec {
  return {
    root: 'quiz-app',
    elements: {
      'quiz-app': {
        type: 'AppShell',
        props: {
          title: 'Quiz demo',
          description: 'A compact quiz flow with radio buttons and a result screen.',
        },
        children: ['quiz-screen', 'quiz-result-screen'],
      },
      'quiz-screen': {
        type: 'Screen',
        props: {
          screenId: 'quiz',
          title: 'Question 1 of 1',
          description: 'Choose the best control for a single-choice answer.',
        },
        children: ['quiz-stack'],
      },
      'quiz-stack': {
        type: 'Group',
        props: {
          direction: 'vertical',
          gap: 'lg',
          align: 'stretch',
          className: 'max-w-2xl',
        },
        children: ['quiz-copy', 'quiz-options', 'quiz-actions'],
      },
      'quiz-copy': {
        type: 'Text',
        props: {
          text: 'Which component is best when the user must choose exactly one answer?',
          variant: 'lead',
        },
        children: [],
      },
      'quiz-options': {
        type: 'RadioGroup',
        props: {
          label: 'Answer',
          name: 'answer',
          options: ['Checkbox', 'RadioGroup', 'TextArea'],
          value: { $bindState: '/quiz/answer' },
          checks: null,
          validateOn: 'change',
        },
        children: [],
      },
      'quiz-actions': {
        type: 'Group',
        props: {
          direction: 'horizontal',
          gap: 'md',
          align: 'center',
          className: 'flex-wrap',
        },
        children: ['quiz-next', 'quiz-hint'],
      },
      'quiz-next': {
        type: 'Button',
        props: {
          label: 'Next',
          variant: 'primary',
          disabled: {
            $state: '/quiz/answer',
            not: true,
          },
        },
        on: {
          press: [
            {
              action: 'write_state',
              params: {
                path: '/quiz/isCorrect',
                value: {
                  $cond: { $state: '/quiz/answer', eq: 'RadioGroup' },
                  $then: true,
                  $else: false,
                },
              },
            },
            {
              action: 'navigate_screen',
              params: {
                screenId: 'result',
              },
            },
          ],
        },
        children: [],
      },
      'quiz-hint': {
        type: 'Text',
        props: {
          text: 'The button stays disabled until an answer is selected.',
          variant: 'caption',
        },
        children: [],
      },
      'quiz-result-screen': {
        type: 'Screen',
        props: {
          screenId: 'result',
          title: 'Result',
          description: 'This second screen is driven by navigate_screen.',
        },
        children: ['quiz-result-stack'],
      },
      'quiz-result-stack': {
        type: 'Group',
        props: {
          direction: 'vertical',
          gap: 'md',
          align: 'stretch',
          className: 'max-w-xl',
        },
        children: ['quiz-result-correct', 'quiz-result-wrong', 'quiz-result-selected', 'quiz-back'],
      },
      'quiz-result-correct': {
        type: 'Text',
        props: {
          text: 'Correct. Radio groups are the right fit for one-of-many answers.',
          variant: 'lead',
        },
        visible: { $state: '/quiz/isCorrect' },
        children: [],
      },
      'quiz-result-wrong': {
        type: 'Text',
        props: {
          text: 'Not quite. A radio group is better than a checkbox or textarea here.',
          variant: 'lead',
        },
        visible: {
          $state: '/quiz/isCorrect',
          not: true,
        },
        children: [],
      },
      'quiz-result-selected': {
        type: 'Text',
        props: {
          text: { $template: 'Selected answer: ${/quiz/answer}' },
          variant: 'muted',
        },
        children: [],
      },
      'quiz-back': {
        type: 'Button',
        props: {
          label: 'Try again',
          variant: 'secondary',
          disabled: false,
        },
        on: {
          press: [
            {
              action: 'write_state',
              params: {
                path: '/quiz/answer',
                value: '',
              },
            },
            {
              action: 'navigate_screen',
              params: {
                screenId: 'quiz',
              },
            },
          ],
        },
        children: [],
      },
    },
  };
}

export function buildAgreementDemoRuntimeState(): BuilderRuntimeState {
  return {
    ...buildEmptyRuntimeState(),
    ui: {
      ...buildEmptyRuntimeState().ui,
      currentScreen: 'agreement-form',
    },
    form: {
      name: '',
      role: 'Engineer',
      notes: '',
      agreed: false,
    },
  };
}

export function buildAgreementDemoSpec(): Spec {
  return {
    root: 'agreement-app',
    elements: {
      'agreement-app': {
        type: 'AppShell',
        props: {
          title: 'Agreement flow demo',
          description: 'A form with text fields, select, checkbox, and a confirmation screen.',
        },
        children: ['agreement-screen', 'agreement-done-screen'],
      },
      'agreement-screen': {
        type: 'Screen',
        props: {
          screenId: 'agreement-form',
          title: 'Confirm your submission',
          description: 'The submit button activates after the checkbox is checked.',
        },
        children: ['agreement-stack'],
      },
      'agreement-stack': {
        type: 'Group',
        props: {
          direction: 'vertical',
          gap: 'lg',
          align: 'stretch',
          className: 'max-w-2xl',
        },
        children: ['agreement-name', 'agreement-role', 'agreement-notes', 'agreement-checkbox', 'agreement-submit'],
      },
      'agreement-name': {
        type: 'Input',
        props: {
          label: 'Name',
          name: 'name',
          type: 'text',
          placeholder: 'Ada Lovelace',
          value: { $bindState: '/form/name' },
          checks: null,
          validateOn: 'blur',
        },
        children: [],
      },
      'agreement-role': {
        type: 'Select',
        props: {
          label: 'Role',
          name: 'role',
          options: ['Engineer', 'Designer', 'Product'],
          placeholder: 'Select a role',
          value: { $bindState: '/form/role' },
          checks: null,
          validateOn: 'change',
        },
        children: [],
      },
      'agreement-notes': {
        type: 'TextArea',
        props: {
          label: 'Notes',
          name: 'notes',
          placeholder: 'Optional context for the submission',
          rows: 4,
          value: { $bindState: '/form/notes' },
          checks: null,
          validateOn: 'blur',
        },
        children: [],
      },
      'agreement-checkbox': {
        type: 'Checkbox',
        props: {
          label: 'I agree with the submission conditions',
          name: 'agreed',
          checked: { $bindState: '/form/agreed' },
          checks: null,
          validateOn: 'change',
        },
        children: [],
      },
      'agreement-submit': {
        type: 'Button',
        props: {
          label: 'Submit',
          variant: 'primary',
          disabled: {
            $state: '/form/agreed',
            not: true,
          },
        },
        on: {
          press: {
            action: 'navigate_screen',
            params: {
              screenId: 'agreement-done',
            },
          },
        },
        children: [],
      },
      'agreement-done-screen': {
        type: 'Screen',
        props: {
          screenId: 'agreement-done',
          title: 'Submitted',
          description: 'The summary screen reads the stored form state back into the UI.',
        },
        children: ['agreement-done-stack'],
      },
      'agreement-done-stack': {
        type: 'Group',
        props: {
          direction: 'vertical',
          gap: 'md',
          align: 'stretch',
          className: 'max-w-xl',
        },
        children: ['agreement-done-title', 'agreement-done-role', 'agreement-done-notes', 'agreement-done-back'],
      },
      'agreement-done-title': {
        type: 'Text',
        props: {
          text: { $template: 'Thanks, ${/form/name}! Your role is ${/form/role}.' },
          variant: 'lead',
        },
        children: [],
      },
      'agreement-done-role': {
        type: 'Text',
        props: {
          text: { $template: 'Agreement status: ${/form/agreed}' },
          variant: 'muted',
        },
        children: [],
      },
      'agreement-done-notes': {
        type: 'Text',
        props: {
          text: { $template: 'Notes: ${/form/notes}' },
          variant: 'body',
        },
        children: [],
      },
      'agreement-done-back': {
        type: 'Button',
        props: {
          label: 'Back to form',
          variant: 'secondary',
          disabled: false,
        },
        on: {
          press: {
            action: 'navigate_screen',
            params: {
              screenId: 'agreement-form',
            },
          },
        },
        children: [],
      },
    },
  };
}

export function extractFirstScreenId(spec: Spec | null) {
  if (!spec) {
    return null;
  }

  for (const element of Object.values(spec.elements)) {
    if (element.type === 'Screen' && typeof element.props?.screenId === 'string') {
      return element.props.screenId;
    }
  }

  return null;
}

export function ensureRuntimeShape(runtimeState: Partial<BuilderRuntimeState> | null | undefined, spec?: Spec | null) {
  const next = deepMergeObjects(buildEmptyRuntimeState(), runtimeState ?? {});
  const firstScreenId = extractFirstScreenId(spec ?? null);

  if (!next.ui.currentScreen && firstScreenId) {
    next.ui.currentScreen = firstScreenId;
  }

  return next;
}

export const builderDemoPresets: BuilderDemoPresetDefinition[] = [
  {
    id: 'todo',
    title: 'Todo list',
    description: 'Collections, filtering, notes, and navigation between two screens.',
    loadMessage: 'Todo demo loaded into the preview.',
    build: () => ({
      spec: buildDefaultSpec(),
      runtimeState: buildDefaultRuntimeState(),
    }),
  },
  {
    id: 'quiz',
    title: 'Quiz flow',
    description: 'Radio buttons, button enablement, and a result screen.',
    loadMessage: 'Quiz demo loaded into the preview.',
    build: () => ({
      spec: buildQuizDemoSpec(),
      runtimeState: buildQuizDemoRuntimeState(),
    }),
  },
  {
    id: 'agreement',
    title: 'Agreement form',
    description: 'Text fields, select, checkbox gating, and a confirmation screen.',
    loadMessage: 'Agreement demo loaded into the preview.',
    build: () => ({
      spec: buildAgreementDemoSpec(),
      runtimeState: buildAgreementDemoRuntimeState(),
    }),
  },
];

export function getBuilderDemoPreset(id: string) {
  return builderDemoPresets.find((preset) => preset.id === id) ?? null;
}

export function mergeRuntimeStateWithSpec(spec: Spec, currentRuntimeState: BuilderRuntimeState) {
  return ensureRuntimeShape(deepMergeObjects(spec.state ?? {}, currentRuntimeState), spec);
}

export function createSnapshot(spec: Spec | null, runtimeState: BuilderRuntimeState, prompt: string): BuilderSnapshot {
  return {
    spec: cloneSpec(spec),
    runtimeState: cloneRuntimeState(runtimeState),
    prompt,
    createdAt: new Date().toISOString(),
  };
}

export function buildExportPayload(spec: Spec, runtimeState: BuilderRuntimeState): BuilderExportPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    spec: cloneSpec(spec)!,
    runtimeState: cloneRuntimeState(runtimeState),
  };
}

export function parseImportedDefinition(rawValue: string) {
  const parsed = JSON.parse(rawValue) as BuilderExportPayload | Spec;

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Imported file must be a JSON object.');
  }

  if ('spec' in parsed) {
    if (!parsed.spec) {
      throw new Error('Import payload is missing a spec.');
    }

    return {
      spec: cloneSpec(parsed.spec)!,
      runtimeState: ensureRuntimeShape(parsed.runtimeState, parsed.spec),
    };
  }

  return {
    spec: cloneSpec(parsed as Spec)!,
    runtimeState: ensureRuntimeShape(undefined, parsed as Spec),
  };
}

export function getDefinitionValidation(spec: Spec | null) {
  if (!spec) {
    return {
      structuralIssues: ['No spec loaded.'],
      catalogIssues: [],
      isValid: false,
      prettyJson: '',
    };
  }

  const structural = validateSpec(spec, { checkOrphans: true });
  const catalogValidation = builderCatalog.validate(spec);

  return {
    structuralIssues: structural.issues.map((issue) => issue.message),
    catalogIssues:
      catalogValidation.success || !catalogValidation.error
        ? []
        : catalogValidation.error.issues.map((issue) =>
            issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
          ),
    isValid: structural.valid && catalogValidation.success,
    prettyJson: JSON.stringify(spec, null, 2),
  };
}
