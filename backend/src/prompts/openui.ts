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
        path: { type: 'string', description: 'Dot-path such as app.tasks, app.profile, or app.settings.theme.' },
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
  Screen("main", "Tasks", [
    Group("Composer", "vertical", [
      Input("draft", "Task", $draft, "Create a todo list"),
      Button("add-task", "Add task", "default", Action([@Run(addTodo), @Run(todos), @Reset($draft)]), false)
    ]),
    Repeater(todoRows, "No tasks yet.")
  ])
])`,
  `$currentScreen = "intro"
$name = ""
$answer = ""

answerOptions = [
  { label: "Option A", value: "a" },
  { label: "Option B", value: "b" }
]

root = AppShell([
  Screen("intro", "Welcome", [
    Text("Enter your name to start.", "body", "start"),
    Input("name", "Name", $name, "Alex"),
    Button("start-button", "Start", "default", Action([@Set($currentScreen, "question")]), false)
  ], $currentScreen == "intro"),
  Screen("question", "Question", [
    RadioGroup("answer", "Choose one option", $answer, answerOptions),
    Button("result-button", "Show result", "default", Action([@Set($currentScreen, "result")]), false)
  ], $currentScreen == "question"),
  Screen("result", "Result", [
    Text("Thanks, " + $name + ".", "title", "start"),
    Button("restart-button", "Restart", "secondary", Action([@Set($currentScreen, "intro"), @Reset($name, $answer)]), false)
  ], $currentScreen == "result")
])`,
];

const additionalRules = [
  'Return only raw OpenUI Lang source. Do not wrap it in markdown, prose, or code fences.',
  'Return the full updated program every time, not a patch.',
  'The root statement must be `root = AppShell([...])`.',
  'Use only the supported components and tools provided in this prompt.',
  'Keep props shallow. Avoid deeply nested configuration objects.',
  'Use Screen for screen-level sections and Group for local layout.',
  'Use Repeater for collections and prefer `@Each(...)` to build repeated rows.',
  'For checklist or todo rows, put the row text into `Checkbox(label=...)` instead of rendering an empty checkbox next to a separate Text node.',
  'Prefer local $variables for ephemeral UI state such as tabs, draft inputs, and internal screen flow.',
  'Screen signature is `Screen(id, title, children, isActive?)`.',
  'Use `Screen(id, title, children, isActive?)` when you need screen-level sections.',
  'Button signature is `Button(id, label, variant, action?, disabled?)`.',
  'For internal multi-screen flows, declare `$currentScreen = "screen-id"` and switch screens with `@Set($currentScreen, "next-screen-id")`.',
  'Use `$currentScreen` + `@Set(...)` for screen navigation.',
  'Do not use `navigate_screen`.',
  'Do not use persisted tools for internal screen navigation. Use tools only for exportable or shared domain data.',
  'Omit isActive for always-visible single-screen apps. Pass a boolean expression only when a screen should conditionally render.',
  'Use Query("read_state", ...) with sensible defaults when reading persisted browser data.',
  'Use write_state, merge_state, append_state, and remove_state for exportable persistent data.',
  'If a Mutation changes data that is rendered by a Query, call `@Run(theQueryStatement)` after the mutation so the preview refreshes immediately.',
  'Every `@Run(ref)` must reference a defined Query or Mutation statement.',
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
