import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrompt, type PromptSpec, type ToolSpec } from '@openuidev/lang-core';

const toolSpecifications: ToolSpec[] = [
  {
    name: 'read_state',
    description: 'Read a value from the persisted browser data tree at the given dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dot-path such as app.tasks or navigation.currentScreenId.' },
      },
      required: ['path'],
    },
    outputSchema: {
      description: 'The value currently stored at the path, or null when the path is missing.',
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: 'write_state',
    description: 'Replace the persisted value at a dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        value: { description: 'Any JSON-compatible value.' },
      },
      required: ['path', 'value'],
    },
    outputSchema: {
      description: 'The value that is now stored at the path.',
    },
  },
  {
    name: 'merge_state',
    description: 'Shallow-merge an object patch into the persisted value at a dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        patch: { type: 'object', additionalProperties: true },
      },
      required: ['path', 'patch'],
    },
    outputSchema: {
      description: 'The merged object stored at the path.',
    },
  },
  {
    name: 'append_state',
    description: 'Append a value to an array stored at a dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        value: { description: 'The JSON-compatible value to append.' },
      },
      required: ['path', 'value'],
    },
    outputSchema: {
      description: 'The updated array stored at the path.',
    },
  },
  {
    name: 'remove_state',
    description: 'Remove an array item by index from the persisted value at a dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        index: { type: 'number' },
      },
      required: ['path', 'index'],
    },
    outputSchema: {
      description: 'The updated array stored at the path.',
    },
  },
  {
    name: 'navigate_screen',
    description:
      'Persist navigation.currentScreenId in browser state when a flow should move between screens. Screen components without an explicit boolean isActive automatically follow this value.',
    inputSchema: {
      type: 'object',
      properties: {
        screenId: { type: 'string' },
      },
      required: ['screenId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        screenId: { type: 'string' },
      },
    },
  },
];

const promptDirectory = path.dirname(fileURLToPath(import.meta.url));
const componentSpecPath = path.resolve(promptDirectory, '../../../shared/openui/component-spec.json');

const preamble =
  'You generate OpenUI Lang for Kitto, a chat-driven browser app builder. Build small frontend-only apps that run entirely in the browser.';

const toolExamples = [
  `$draft = ""
todos = Query("read_state", { path: "app.todos" }, [])
addTodo = Mutation("append_state", { path: "app.todos", value: { title: $draft, completed: false } })
todoRows = @Each(todos, "todo", Group(null, "vertical", [
  Checkbox("done-" + todo.title, todo.title, todo.completed)
]))
root = AppShell([
  Screen("main", "Tasks", true, [
    Group("Composer", "vertical", [
      Input("draft", "Task", $draft, "Create a todo list"),
      Button("add-task", "Add task", "default", Action([@Run(addTodo), @Run(todos), @Reset($draft)]), false)
    ]),
    Repeater(todoRows, "No tasks yet.")
  ])
])`,
  `goIntro = Mutation("navigate_screen", { screenId: "intro" })
goQuestion1 = Mutation("navigate_screen", { screenId: "question1" })
goQuestion2 = Mutation("navigate_screen", { screenId: "question2" })
goResult = Mutation("navigate_screen", { screenId: "result" })
root = AppShell([
  Screen("intro", "Welcome", null, [
    Text("Three quick questions are coming next.", "body", "start"),
    Button("start-quiz", "Start", "default", Action([@Run(goQuestion1)]), false)
  ]),
  Screen("question1", "Question 1", null, [
    RadioGroup("answer", "Pick one answer", "a", [
      { label: "Option A", value: "a" },
      { label: "Option B", value: "b" }
    ]),
    Group(null, "horizontal", [
      Button("next-question1", "Next", "secondary", Action([@Run(goQuestion2)]), false),
      Button("back-question1", "Back", "secondary", Action([@Run(goIntro)]), false)
    ])
  ]),
  Screen("question2", "Question 2", null, [
    RadioGroup("answer", "Pick another answer", "a", [
      { label: "Option A", value: "a" },
      { label: "Option B", value: "b" }
    ]),
    Group(null, "horizontal", [
      Button("next-question2", "Next", "secondary", Action([@Run(goResult)]), false),
      Button("back-question2", "Back", "secondary", Action([@Run(goQuestion1)]), false)
    ])
  ]),
  Screen("result", "Result", null, [
    Text("Show result screen after the last question.", "title", "start"),
    Button("restart-quiz", "Restart", "destructive", Action([@Run(goIntro)]), false)
  ])
])`,
];

const additionalRules = [
  'Return only raw OpenUI Lang source. Do not wrap it in markdown, prose, or code fences.',
  'Return the full updated program every time, not a patch.',
  'The root statement must be `root = AppShell([...])`.',
  'Use only the provided components and the supported tool names.',
  'Keep props shallow. Avoid deeply nested configuration objects.',
  'Use Screen for screen-level sections and Group for local layout.',
  'Use Repeater for collections and prefer `@Each(...)` to build repeated rows.',
  'For checklist or todo rows, put the row text into `Checkbox(label=...)` instead of rendering an empty checkbox next to a separate Text node.',
  'Prefer local $variables for ephemeral UI state such as tabs and draft inputs.',
  'For multi-screen flows, prefer Mutation("navigate_screen", { screenId }) and let Screen derive visibility from persisted navigation.currentScreenId by passing null for isActive.',
  'Explicit boolean isActive still wins when you need a deterministic first screen or a pinned/hidden screen.',
  'Use Query("read_state", ...) with sensible defaults when reading persisted browser data.',
  'Use write_state, merge_state, append_state, and remove_state for exportable persistent data.',
  'If a Mutation changes data that is rendered by a Query, call `@Run(theQueryStatement)` after the mutation so the preview refreshes immediately.',
  'Every Button must start with a stable id string so button state and actions stay deterministic.',
  'Every referenced identifier must be defined in the final source exactly once. Never leave unresolved references such as @Run(deleteTodo) without a matching statement.',
  'Before returning, mentally verify every Repeater(...), @Run(...), component reference, and statement identifier so the program has zero unresolved references.',
  'Generated apps must stay browser-safe and must not depend on server-side execution after generation.',
  'Support flows involving text fields, collections, buttons, local state, and filtering or conditional rendering when the user asks for them.',
];

function readComponentSpec() {
  return JSON.parse(fs.readFileSync(componentSpecPath, 'utf8')) as PromptSpec;
}

export interface PromptBuildRequest {
  chatHistory: Array<{
    content: string;
    role: 'assistant' | 'system' | 'user';
  }>;
  currentSource: string;
  prompt: string;
}

interface BuildOpenUiUserPromptOptions {
  chatHistoryMaxItems?: number;
}

export function buildOpenUiSystemPrompt() {
  return generatePrompt({
    ...readComponentSpec(),
    tools: toolSpecifications,
    toolCalls: true,
    bindings: true,
    editMode: false,
    inlineMode: false,
    preamble,
    toolExamples,
    additionalRules,
  });
}

export function buildOpenUiUserPrompt(request: PromptBuildRequest, options: BuildOpenUiUserPromptOptions = {}) {
  const prompt = typeof request.prompt === 'string' ? request.prompt : '';
  const currentSourceValue = typeof request.currentSource === 'string' ? request.currentSource : '';
  const chatHistory = Array.isArray(request.chatHistory) ? request.chatHistory : [];
  const chatHistoryMaxItems =
    typeof options.chatHistoryMaxItems === 'number' && options.chatHistoryMaxItems > 0 ? Math.floor(options.chatHistoryMaxItems) : 8;
  const recentHistory = chatHistory
    .slice(-chatHistoryMaxItems)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n');
  const currentSource = currentSourceValue.trim() ? currentSourceValue : '(blank canvas, no current OpenUI source yet)';

  return [
    'Update the current Kitto app definition based on the latest user request.',
    `Latest user request:\n${prompt}`,
    `Current full OpenUI source:\n${currentSource}`,
    recentHistory ? `Recent chat context:\n${recentHistory}` : null,
    'Return the full updated OpenUI Lang program only.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
