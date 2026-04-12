import { defineCatalog, buildUserPrompt, validateSpec, autoFixSpec, type Spec } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
import { z } from 'zod';

const stackLikeProps = {
  direction: z.enum(['vertical', 'horizontal']).nullable(),
  gap: z.enum(['none', 'sm', 'md', 'lg', 'xl']).nullable(),
  align: z.enum(['start', 'center', 'end', 'stretch']).nullable(),
  className: z.string().nullable(),
};

export const jsonRenderCatalog = defineCatalog(schema, {
  components: {
    AppShell: {
      props: z.object({
        title: z.string().nullable(),
        description: z.string().nullable(),
      }),
      slots: ['default'],
      description: 'Top-level generated app container. Prefer this as the root element.',
    },
    Screen: {
      props: z.object({
        screenId: z.string(),
        title: z.string().nullable(),
        description: z.string().nullable(),
      }),
      slots: ['default'],
      description:
        'Logical app screen. The runtime shows the screen whose screenId matches /ui/currentScreen. Use this for multi-step apps.',
    },
    Group: {
      props: z.object(stackLikeProps),
      slots: ['default'],
      description: 'Flexible layout group for arranging children vertically or horizontally.',
    },
    Repeater: {
      props: z.object({
        emptyText: z.string().nullable(),
        className: z.string().nullable(),
      }),
      slots: ['default'],
      description:
        'Container for repeated children. Put repeat metadata on the element itself with repeat.statePath pointing at an array.',
    },
    Text: {
      ...shadcnComponentDefinitions.Text,
      description: 'Short or long text content. Use text prop for the visible copy.',
    },
    Input: shadcnComponentDefinitions.Input,
    TextArea: {
      ...shadcnComponentDefinitions.Textarea,
      description: 'Multi-line textarea. Use value with $bindState for editable text.',
    },
    Checkbox: shadcnComponentDefinitions.Checkbox,
    RadioGroup: {
      ...shadcnComponentDefinitions.Radio,
      description: 'Radio group. Use value with $bindState to store the selected option.',
    },
    Select: shadcnComponentDefinitions.Select,
    Button: shadcnComponentDefinitions.Button,
    Link: shadcnComponentDefinitions.Link,
  },
  actions: {
    read_state: {
      params: z.object({
        path: z.string(),
        targetPath: z.string(),
        fallback: z.unknown().optional(),
      }),
      description: 'Read a value from state and write it to another state path.',
    },
    write_state: {
      params: z.object({
        path: z.string(),
        value: z.unknown(),
      }),
      description: 'Write a value to a state path.',
    },
    merge_state: {
      params: z.object({
        path: z.string(),
        patch: z.record(z.string(), z.unknown()),
      }),
      description: 'Shallow-merge an object patch into an existing state object.',
    },
    append_state: {
      params: z.object({
        path: z.string(),
        value: z.unknown(),
      }),
      description: 'Append a value to an array stored at the state path.',
    },
    remove_state: {
      params: z.object({
        path: z.string(),
        index: z.number().int().nonnegative(),
      }),
      description: 'Remove an array item by index from the state path.',
    },
    open_url: {
      params: z.object({
        url: z.string().min(1),
      }),
      description: 'Open an external URL in a new browser tab.',
    },
    navigate_screen: {
      params: z.object({
        screenId: z.string(),
      }),
      description: 'Switch the visible Screen by writing screenId into /ui/currentScreen.',
    },
  },
});

const customPromptRules = [
  'Use only the catalog components and actions listed in this prompt.',
  'Root element should normally be AppShell.',
  'Use Screen for every top-level app screen and keep screenId values stable.',
  'The runtime controls screen changes through /ui/currentScreen and navigate_screen.',
  'Use Repeater for collections and put repeat metadata on the element itself: repeat.statePath must point to an array.',
  'Use $bindState on editable controls: Input.value, TextArea.value, Checkbox.checked, Select.value, RadioGroup.value.',
  'Prefer the named actions write_state, merge_state, append_state, remove_state, open_url, navigate_screen when user interactions need them.',
  'You may also use built-in actions setState, pushState, removeState when that produces a smaller diff.',
  'Support filtering and conditional rendering with visible conditions and current state.',
  'If repair context is included, fix the failed patch stream for the same request instead of answering conversationally.',
  'Keep ids stable when editing an existing spec and make the smallest valid patch set possible.',
  'Avoid deep nesting and do not emit prose or markdown fences. Output JSON Patch lines only.',
];

export function buildJsonRenderSystemPrompt() {
  return jsonRenderCatalog.prompt({
    mode: 'standalone',
    editModes: ['patch'],
    customRules: customPromptRules,
  });
}

function buildConversationContext(messages?: Array<{ role: 'user' | 'assistant'; content: string }>) {
  if (!messages?.length) {
    return '';
  }

  return messages
    .slice(-8)
    .map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`)
    .join('\n');
}

function trimRepairLines(rawLines?: string[]) {
  if (!rawLines?.length) {
    return 'No raw patch lines were captured before the failure.';
  }

  return rawLines
    .slice(-40)
    .join('\n')
    .slice(0, 6000);
}

function buildRepairContext(repairContext?: {
  attempt: number;
  error: string;
  rawLines?: string[];
}) {
  if (!repairContext) {
    return '';
  }

  return [
    `Repair attempt: ${repairContext.attempt}.`,
    'The previous streamed patch response was invalid and could not be applied.',
    `Error: ${repairContext.error}`,
    'Failed patch lines:',
    trimRepairLines(repairContext.rawLines),
    'Continue the same builder request and return only corrected JSON Patch lines.',
  ].join('\n');
}

export function buildJsonRenderUserPrompt(input: {
  prompt: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentSpec?: Spec | null;
  runtimeState?: Record<string, unknown> | null;
  repairContext?: {
    attempt: number;
    error: string;
    rawLines?: string[];
  };
}) {
  const conversationContext = buildConversationContext(input.messages);
  const repairContext = buildRepairContext(input.repairContext);
  const prompt =
    conversationContext.length > 0
      ? `Conversation so far:\n${conversationContext}\n\nLatest builder request:\n${input.prompt}`
      : input.prompt;
  const nextPrompt = repairContext.length > 0 ? `${prompt}\n\nRepair context:\n${repairContext}` : prompt;

  return buildUserPrompt({
    prompt: nextPrompt,
    currentSpec: input.currentSpec,
    state: input.runtimeState ?? undefined,
    editModes: ['patch'],
    format: 'json',
  });
}

export function finalizeGeneratedSpec(spec: Spec) {
  const { spec: autoFixedSpec } = autoFixSpec(spec);
  const parsed = jsonRenderCatalog.validate(autoFixedSpec);

  if (!parsed.success || !parsed.data) {
    const errorMessage = parsed.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(errorMessage || 'Generated spec does not match the catalog schema.');
  }

  const candidateSpec = parsed.data as unknown as Spec;
  const structural = validateSpec(candidateSpec, { checkOrphans: true });
  const blockingIssues = structural.issues.filter((issue) => issue.severity === 'error');

  if (blockingIssues.length > 0) {
    throw new Error(blockingIssues.map((issue) => issue.message).join('; '));
  }

  return {
    spec: candidateSpec,
    issues: structural.issues.map((issue) => issue.message),
  };
}
