import { useMemo } from 'react';
import type { Spec, StateModel, StateStore } from '@json-render/core';
import { createStoreAdapter } from '@json-render/core/store-utils';
import { JSONUIProvider, Renderer, type SetState } from '@json-render/react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { ScrollArea } from '@components/ui/scroll-area';
import { PreviewRuntimeBoundary } from '@features/builder/components/PreviewRuntimeBoundary';
import { builderRegistry } from '@features/builder/jsonui/registry';
import { builderRuntimeFunctions } from '@features/builder/jsonui/runtime/functions';
import { buildEmptyRuntimeState, type BuilderRuntimeState } from '@features/builder/utils/state';

type CatalogElementDemo = {
  id: string;
  title: string;
  schema: Record<string, unknown>;
  spec: Spec;
  initialState: BuilderRuntimeState;
};

type CatalogActionDemo = {
  id: string;
  title: string;
  schema: Record<string, unknown>;
};

type LocalRuntimeController = {
  store: StateStore;
  getSnapshot: () => StateModel;
  replaceSnapshot: (next: StateModel) => void;
};

type CatalogRuntimePatch = Omit<Partial<BuilderRuntimeState>, 'ui' | 'form' | 'data' | 'local'> & {
  ui?: Partial<BuilderRuntimeState['ui']>;
  form?: Record<string, unknown>;
  data?: Record<string, unknown>;
  local?: Record<string, unknown>;
};

function createDemoRuntimeState(patch?: CatalogRuntimePatch): BuilderRuntimeState {
  const base = buildEmptyRuntimeState();

  return {
    ...base,
    ...patch,
    ui: {
      ...base.ui,
      ...(patch?.ui ?? {}),
      currentScreen: patch?.ui?.currentScreen ?? 'demo',
    },
    form: {
      ...base.form,
      ...(patch?.form ?? {}),
    },
    data: {
      ...base.data,
      ...(patch?.data ?? {}),
    },
    local: {
      ...base.local,
      ...(patch?.local ?? {}),
    },
  };
}

function createLocalRuntimeController(initialState: StateModel): LocalRuntimeController {
  let snapshot = structuredClone(initialState);
  const listeners = new Set<() => void>();

  const store = createStoreAdapter({
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  });

  return {
    store,
    getSnapshot: () => snapshot,
    replaceSnapshot: (next) => {
      snapshot = structuredClone(next);
      listeners.forEach((listener) => listener());
    },
  };
}

function createSingleScreenSpec(config: {
  prefix: string;
  appTitle: string;
  appDescription: string;
  screenTitle: string;
  screenDescription: string;
  screenChildren: string[];
  elements: Spec['elements'];
}): Spec {
  const appId = `${config.prefix}-app`;
  const screenId = `${config.prefix}-screen`;

  return {
    root: appId,
    elements: {
      [appId]: {
        type: 'AppShell',
        props: {
          title: config.appTitle,
        },
        children: [screenId],
      },
      [screenId]: {
        type: 'Screen',
        props: {
          screenId: 'demo',
          title: config.screenTitle,
        },
        children: config.screenChildren,
      },
      ...config.elements,
    },
  };
}

const appShellSchema = {
  type: 'AppShell',
  props: {
    title: 'AppShell demo',
  },
  children: ['app-shell-screen'],
};

const screenSchema = {
  type: 'Screen',
  props: {
    screenId: 'details',
    title: 'Details screen',
  },
  children: ['screen-demo-copy', 'screen-demo-back'],
};

const groupSchema = {
  type: 'Group',
  props: {
    direction: 'horizontal',
    gap: 'md',
    align: 'center',
    className: 'flex-wrap rounded-[1.25rem] border border-border/70 bg-background/80 p-4',
  },
  children: ['group-demo-copy', 'group-demo-button', 'group-demo-status'],
};

const repeaterSchema = {
  type: 'Repeater',
  props: {
    emptyText: 'Nothing in the collection yet.',
    className: 'space-y-3',
  },
  repeat: {
    statePath: '/data/items',
  },
  children: ['repeater-row'],
};

const textSchema = {
  type: 'Text',
  props: {
    text: 'Text renders plain copy, lead text, captions, and template-based values.',
    variant: 'lead',
  },
  children: [],
};

const inputSchema = {
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
};

const textAreaSchema = {
  type: 'TextArea',
  props: {
    label: 'Notes',
    name: 'notes',
    placeholder: 'Write a longer description here',
    rows: 4,
    value: { $bindState: '/form/notes' },
    checks: null,
    validateOn: 'blur',
  },
  children: [],
};

const checkboxSchema = {
  type: 'Checkbox',
  props: {
    label: 'I agree with the terms',
    name: 'agreed',
    checked: { $bindState: '/form/agreed' },
    checks: null,
    validateOn: 'change',
  },
  children: [],
};

const radioGroupSchema = {
  type: 'RadioGroup',
  props: {
    label: 'Choose a layout',
    name: 'layout',
    options: ['Stacked', 'Split', 'Compact'],
    value: { $bindState: '/form/layout' },
    checks: null,
    validateOn: 'change',
  },
  children: [],
};

const selectSchema = {
  type: 'Select',
  props: {
    label: 'Status',
    name: 'status',
    options: ['Draft', 'Ready', 'Published'],
    placeholder: 'Choose a status',
    value: { $bindState: '/form/status' },
    checks: null,
    validateOn: 'change',
  },
  children: [],
};

const buttonSchema = {
  type: 'Button',
  props: {
    label: 'Write local state',
    variant: 'primary',
    disabled: false,
  },
  on: {
    press: {
      action: 'write_state',
      params: {
        path: '/local/buttonPressed',
        value: true,
      },
    },
  },
  children: [],
};

const linkSchema = {
  type: 'Link',
  props: {
    label: 'Open json-render.dev',
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
};

const elementCatalogDemos: CatalogElementDemo[] = [
  {
    id: 'appshell',
    title: 'AppShell',
    schema: appShellSchema,
    spec: {
      root: 'app-shell-root',
      elements: {
        'app-shell-root': appShellSchema,
        'app-shell-screen': {
          type: 'Screen',
          props: {
            screenId: 'demo',
            title: 'Inside the shell',
          },
          children: ['app-shell-copy'],
        },
        'app-shell-copy': {
          type: 'Text',
          props: {
            text: 'This content sits inside AppShell and Screen.',
            variant: 'body',
          },
          children: [],
        },
      },
    },
    initialState: createDemoRuntimeState(),
  },
  {
    id: 'screen',
    title: 'Screen',
    schema: screenSchema,
    spec: {
      root: 'screen-demo-app',
      elements: {
        'screen-demo-app': {
          type: 'AppShell',
          props: {
            title: 'Screen demo',
          },
          children: ['screen-demo-home', 'screen-demo-details'],
        },
        'screen-demo-home': {
          type: 'Screen',
          props: {
            screenId: 'home',
            title: 'Home screen',
          },
          children: ['screen-demo-home-copy'],
        },
        'screen-demo-home-copy': {
          type: 'Text',
          props: {
            text: 'This screen is currently hidden.',
            variant: 'muted',
          },
          children: [],
        },
        'screen-demo-details': screenSchema,
        'screen-demo-copy': {
          type: 'Text',
          props: {
            text: 'The Screen component acts like a conditional page section inside one spec.',
            variant: 'body',
          },
          children: [],
        },
        'screen-demo-back': {
          type: 'Button',
          props: {
            label: 'Show home screen',
            variant: 'secondary',
            disabled: false,
          },
          on: {
            press: {
              action: 'navigate_screen',
              params: {
                screenId: 'home',
              },
            },
          },
          children: [],
        },
      },
    },
    initialState: createDemoRuntimeState({
      ui: {
        currentScreen: 'details',
      },
    }),
  },
  {
    id: 'group',
    title: 'Group',
    schema: groupSchema,
    spec: createSingleScreenSpec({
      prefix: 'group-demo',
      appTitle: 'Group demo',
      appDescription: 'A horizontal arrangement with wrapped children.',
      screenTitle: 'Composable layout',
      screenDescription: 'Group controls direction, gap, alignment, and extra classes.',
      screenChildren: ['group-demo-group'],
      elements: {
        'group-demo-group': groupSchema,
        'group-demo-copy': {
          type: 'Text',
          props: {
            text: 'Left content',
            variant: 'body',
          },
          children: [],
        },
        'group-demo-button': {
          type: 'Button',
          props: {
            label: 'Right action',
            variant: 'secondary',
            disabled: false,
          },
          on: {
            press: {
              action: 'write_state',
              params: {
                path: '/local/groupStatus',
                value: 'Clicked',
              },
            },
          },
          children: [],
        },
        'group-demo-status': {
          type: 'Text',
          props: {
            text: { $template: 'Status: ${/local/groupStatus}' },
            variant: 'caption',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      local: {
        groupStatus: 'Idle',
      },
    }),
  },
  {
    id: 'repeater',
    title: 'Repeater',
    schema: repeaterSchema,
    spec: createSingleScreenSpec({
      prefix: 'repeater-demo',
      appTitle: 'Repeater demo',
      appDescription: 'A repeated list of collection items from state.',
      screenTitle: 'Collection preview',
      screenDescription: 'Each item reads from /data/items.',
      screenChildren: ['repeater-demo-repeater'],
      elements: {
        'repeater-demo-repeater': repeaterSchema,
        'repeater-row': {
          type: 'Group',
          props: {
            direction: 'horizontal',
            gap: 'md',
            align: 'center',
            className: 'justify-between rounded-[1.25rem] border border-border/70 bg-background/80 p-4',
          },
          children: ['repeater-item-text', 'repeater-item-index'],
        },
        'repeater-item-text': {
          type: 'Text',
          props: {
            text: { $template: '${label}' },
            variant: 'body',
          },
          children: [],
        },
        'repeater-item-index': {
          type: 'Text',
          props: {
            text: { $template: 'Row ${index}' },
            variant: 'caption',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      data: {
        items: [
          { label: 'First repeated item', index: 1 },
          { label: 'Second repeated item', index: 2 },
          { label: 'Third repeated item', index: 3 },
        ],
      },
    }),
  },
  {
    id: 'text',
    title: 'Text',
    schema: textSchema,
    spec: createSingleScreenSpec({
      prefix: 'text-demo',
      appTitle: 'Text demo',
      appDescription: 'A simple text element in context.',
      screenTitle: 'Readable copy',
      screenDescription: 'Text can be literal, templated, or computed.',
      screenChildren: ['text-demo-element', 'text-demo-status'],
      elements: {
        'text-demo-element': textSchema,
        'text-demo-status': {
          type: 'Text',
          props: {
            text: { $template: 'Bound name: ${/form/name}' },
            variant: 'muted',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      form: {
        name: 'Ada Lovelace',
      },
    }),
  },
  {
    id: 'input',
    title: 'Input',
    schema: inputSchema,
    spec: createSingleScreenSpec({
      prefix: 'input-demo',
      appTitle: 'Input demo',
      appDescription: 'Edit the field and watch state-backed rendering update.',
      screenTitle: 'Bound field',
      screenDescription: 'The preview is fully interactive.',
      screenChildren: ['input-demo-field', 'input-demo-copy'],
      elements: {
        'input-demo-field': inputSchema,
        'input-demo-copy': {
          type: 'Text',
          props: {
            text: { $template: 'Current value: ${/form/name}' },
            variant: 'muted',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      form: {
        name: 'Ada Lovelace',
      },
    }),
  },
  {
    id: 'textarea',
    title: 'TextArea',
    schema: textAreaSchema,
    spec: createSingleScreenSpec({
      prefix: 'textarea-demo',
      appTitle: 'TextArea demo',
      appDescription: 'Multi-line state binding for longer notes.',
      screenTitle: 'Long-form input',
      screenDescription: 'Type into the field to update /form/notes.',
      screenChildren: ['textarea-demo-field', 'textarea-demo-copy'],
      elements: {
        'textarea-demo-field': textAreaSchema,
        'textarea-demo-copy': {
          type: 'Text',
          props: {
            text: { $template: 'Saved note: ${/form/notes}' },
            variant: 'caption',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      form: {
        notes: 'Use TextArea when the generated app needs multi-line input.',
      },
    }),
  },
  {
    id: 'checkbox',
    title: 'Checkbox',
    schema: checkboxSchema,
    spec: createSingleScreenSpec({
      prefix: 'checkbox-demo',
      appTitle: 'Checkbox demo',
      appDescription: 'Boolean state binding for consent or feature toggles.',
      screenTitle: 'Toggle state',
      screenDescription: 'The text below reads from the same bound path.',
      screenChildren: ['checkbox-demo-field', 'checkbox-demo-copy'],
      elements: {
        'checkbox-demo-field': checkboxSchema,
        'checkbox-demo-copy': {
          type: 'Text',
          props: {
            text: { $template: 'Agreed: ${/form/agreed}' },
            variant: 'muted',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      form: {
        agreed: true,
      },
    }),
  },
  {
    id: 'radiogroup',
    title: 'RadioGroup',
    schema: radioGroupSchema,
    spec: createSingleScreenSpec({
      prefix: 'radio-demo',
      appTitle: 'RadioGroup demo',
      appDescription: 'One-of-many selection with $bindState.',
      screenTitle: 'Single-choice field',
      screenDescription: 'Choose one option and the text mirrors the selected value.',
      screenChildren: ['radio-demo-field', 'radio-demo-copy'],
      elements: {
        'radio-demo-field': radioGroupSchema,
        'radio-demo-copy': {
          type: 'Text',
          props: {
            text: { $template: 'Selected layout: ${/form/layout}' },
            variant: 'muted',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      form: {
        layout: 'Split',
      },
    }),
  },
  {
    id: 'select',
    title: 'Select',
    schema: selectSchema,
    spec: createSingleScreenSpec({
      prefix: 'select-demo',
      appTitle: 'Select demo',
      appDescription: 'Dropdown selection bound directly to runtime state.',
      screenTitle: 'Compact choice',
      screenDescription: 'The selected option is stored in /form/status.',
      screenChildren: ['select-demo-field', 'select-demo-copy'],
      elements: {
        'select-demo-field': selectSchema,
        'select-demo-copy': {
          type: 'Text',
          props: {
            text: { $template: 'Selected status: ${/form/status}' },
            variant: 'muted',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      form: {
        status: 'Ready',
      },
    }),
  },
  {
    id: 'button',
    title: 'Button',
    schema: buttonSchema,
    spec: createSingleScreenSpec({
      prefix: 'button-demo',
      appTitle: 'Button demo',
      appDescription: 'Press the button to mutate local runtime state.',
      screenTitle: 'Action trigger',
      screenDescription: 'The text below updates after the press handler runs.',
      screenChildren: ['button-demo-group'],
      elements: {
        'button-demo-group': {
          type: 'Group',
          props: {
            direction: 'vertical',
            gap: 'md',
            align: 'stretch',
            className: 'max-w-xl',
          },
          children: ['button-demo-button', 'button-demo-copy'],
        },
        'button-demo-button': buttonSchema,
        'button-demo-copy': {
          type: 'Text',
          props: {
            text: { $template: 'Pressed: ${/local/buttonPressed}' },
            variant: 'muted',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState({
      local: {
        buttonPressed: false,
      },
    }),
  },
  {
    id: 'link',
    title: 'Link',
    schema: linkSchema,
    spec: createSingleScreenSpec({
      prefix: 'link-demo',
      appTitle: 'Link demo',
      appDescription: 'A link can keep semantic anchor markup and still use open_url.',
      screenTitle: 'External navigation',
      screenDescription: 'This demo opens the official json-render site in a new tab.',
      screenChildren: ['link-demo-group'],
      elements: {
        'link-demo-group': {
          type: 'Group',
          props: {
            direction: 'vertical',
            gap: 'sm',
            align: 'start',
            className: 'max-w-xl',
          },
          children: ['link-demo-link', 'link-demo-copy'],
        },
        'link-demo-link': linkSchema,
        'link-demo-copy': {
          type: 'Text',
          props: {
            text: 'The click handler uses open_url and prevents the default anchor navigation.',
            variant: 'caption',
          },
          children: [],
        },
      },
    }),
    initialState: createDemoRuntimeState(),
  },
];

const actionCatalogDemos: CatalogActionDemo[] = [
  {
    id: 'read-state',
    title: 'read_state(path)',
    schema: {
      action: 'read_state',
      params: {
        path: '/data/items/0/label',
        targetPath: '/local/selectedLabel',
        fallback: 'No item selected',
      },
    },
  },
  {
    id: 'write-state',
    title: 'write_state(path, value)',
    schema: {
      action: 'write_state',
      params: {
        path: '/form/name',
        value: 'Ada Lovelace',
      },
    },
  },
  {
    id: 'merge-state',
    title: 'merge_state(path, patch)',
    schema: {
      action: 'merge_state',
      params: {
        path: '/local/preferences',
        patch: {
          theme: 'paper',
          density: 'compact',
        },
      },
    },
  },
  {
    id: 'append-state',
    title: 'append_state(path, value)',
    schema: {
      action: 'append_state',
      params: {
        path: '/data/items',
        value: {
          label: 'New generated item',
        },
      },
    },
  },
  {
    id: 'remove-state',
    title: 'remove_state(path, index)',
    schema: {
      action: 'remove_state',
      params: {
        path: '/data/items',
        index: 0,
      },
    },
  },
  {
    id: 'open-url',
    title: 'open_url(url)',
    schema: {
      action: 'open_url',
      params: {
        url: 'https://json-render.dev',
      },
    },
  },
  {
    id: 'navigate-screen',
    title: 'navigate_screen(screenId)',
    schema: {
      action: 'navigate_screen',
      params: {
        screenId: 'summary',
      },
    },
  },
];

type CatalogDemoRendererProps = {
  spec: Spec;
  initialState: BuilderRuntimeState;
};

function CatalogDemoRenderer({ spec, initialState }: CatalogDemoRendererProps) {
  const runtime = useMemo(() => createLocalRuntimeController(initialState), [initialState]);

  const handlers = useMemo(() => {
    const setState: SetState = (updater) => {
      const current = runtime.getSnapshot() as Record<string, unknown>;
      runtime.replaceSnapshot(updater(current));
    };

    return builderRegistry.handlers(() => setState, () => runtime.getSnapshot());
  }, [runtime]);

  function handleResetDemo() {
    runtime.replaceSnapshot(initialState);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleResetDemo}>
          <RotateCcw className="size-4" />
          Reset demo
        </Button>
      </div>

      <PreviewRuntimeBoundary onClear={handleResetDemo} clearLabel="Reset demo">
        <JSONUIProvider
          registry={builderRegistry.registry}
          store={runtime.store}
          handlers={handlers}
          functions={builderRuntimeFunctions}
        >
          <Renderer spec={spec} registry={builderRegistry.registry} />
        </JSONUIProvider>
      </PreviewRuntimeBoundary>
    </div>
  );
}

export default function CatalogPage() {
  return (
    <section className="space-y-6">
      <Card className="border-border/70 bg-card/95">
        <CardHeader>
          <CardTitle className="font-serif text-4xl leading-tight">Catalog</CardTitle>
        </CardHeader>
      </Card>

      <div className="grid gap-6">
        {elementCatalogDemos.map((demo) => (
          <Card key={demo.id} className="overflow-hidden border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">{demo.title}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
              <div className="rounded-[1.5rem] border border-border/70 bg-background/70 p-4">
                <CatalogDemoRenderer spec={demo.spec} initialState={demo.initialState} />
              </div>

              <div className="space-y-3">
                <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Element schema</div>
                <ScrollArea className="h-[24rem] rounded-[1.25rem] border border-border/70 bg-slate-950">
                  <pre className="px-4 py-4 text-xs leading-6 text-slate-100">{JSON.stringify(demo.schema, null, 2)}</pre>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/70 bg-card/95">
        <CardHeader>
          <CardTitle className="font-serif text-3xl">Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {actionCatalogDemos.map((actionDemo) => (
            <Card key={actionDemo.id} className="border-border/70 bg-background/70">
              <CardHeader>
                <CardTitle className="text-lg">{actionDemo.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-52 rounded-[1.25rem] border border-border/70 bg-slate-950">
                  <pre className="px-4 py-4 text-xs leading-6 text-slate-100">{JSON.stringify(actionDemo.schema, null, 2)}</pre>
                </ScrollArea>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
