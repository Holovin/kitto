import { generatePrompt, type ToolSpec } from '@openuidev/lang-core';

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
    name: 'open_url',
    description: 'Open a URL in the browser. Use this for external documentation or resources.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        opened: { type: 'boolean' },
        url: { type: 'string' },
      },
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

const systemPrompt = generatePrompt({
  root: 'AppShell',
  components: {
    AppShell: {
      signature: 'AppShell(title?, children)',
      description: 'Root container for the generated app. Must be assigned to root.',
    },
    Screen: {
      signature: 'Screen(id, title?, isActive?, children)',
      description:
        'Screen-level section for steps or view states inside the generated app. Explicit boolean isActive overrides automatic navigation; use null to let Screen follow persisted navigation.currentScreenId.',
    },
    Group: {
      signature: 'Group(title?, description?, direction, children)',
      description: 'Local layout container. direction is vertical, horizontal, or grid.',
    },
    Repeater: {
      signature: 'Repeater(children, emptyText?)',
      description: 'Collection container. Usually receives @Each(...) results.',
    },
    Text: {
      signature: 'Text(value, tone, align)',
      description: 'Display copy. tone can be body, muted, title, eyebrow, or code.',
    },
    Input: {
      signature: 'Input(name, label, value, placeholder?, helper?)',
      description: 'Single-line text field. Bind value to a $variable for user input.',
    },
    TextArea: {
      signature: 'TextArea(name, label, value, placeholder?, helper?)',
      description: 'Multi-line text input.',
    },
    Checkbox: {
      signature: 'Checkbox(name, label, checked, helper?)',
      description: 'Boolean field for consent, toggles, and checklist rows. Put the visible item text in the label.',
    },
    RadioGroup: {
      signature: 'RadioGroup(name, label, value, options, helper?)',
      description: 'Single-choice list of { label, value } options.',
    },
    Select: {
      signature: 'Select(name, label, value, options, helper?)',
      description: 'Dropdown choice from { label, value } options.',
    },
    Button: {
      signature: 'Button(label, variant, action, disabled?, id?)',
      description:
        'Action trigger. Use Action([...]) with @Run, @Set, @Reset, or @OpenUrl steps. Pass a stable id as the last argument when labels repeat.',
    },
    Link: {
      signature: 'Link(label, url, newTab?)',
      description: 'Plain text link for routes or external URLs.',
    },
  },
  componentGroups: [
    {
      name: 'Containers',
      components: ['AppShell', 'Screen', 'Group', 'Repeater', 'Text'],
      notes: ['Use Screen for major steps and Group for local layout.'],
    },
    {
      name: 'Inputs',
      components: ['Input', 'TextArea', 'Checkbox', 'RadioGroup', 'Select'],
      notes: ['Bind interactive props to $variables when the user should control them.'],
    },
    {
      name: 'Actions',
      components: ['Button', 'Link'],
      notes: ['Use Button with Action([...]) for all imperative flows.'],
    },
  ],
  tools: toolSpecifications,
  toolCalls: true,
  bindings: true,
  preamble:
    'You generate OpenUI Lang for Kitto, a chat-driven browser app builder. Build small frontend-only apps that run entirely in the browser.',
  toolExamples: [
    `$draft = ""
todos = Query("read_state", { path: "app.todos" }, [])
addTodo = Mutation("append_state", { path: "app.todos", value: { title: $draft, completed: false } })
todoRows = @Each(todos, "todo", Group(null, null, "vertical", [
  Checkbox("done-" + todo.title, todo.title, todo.completed, null)
]))
root = AppShell("Todo list", [
  Screen("main", "Tasks", true, [
    Group("Composer", "Capture the next task", "vertical", [
      Input("draft", "Task", $draft, "Create a todo list", null),
      Button("Add task", "default", Action([@Run(addTodo), @Run(todos), @Reset($draft)]), false)
    ]),
    Repeater(todoRows, "No tasks yet.")
  ])
])`,
    `goIntro = Mutation("navigate_screen", { screenId: "intro" })
goQuestion1 = Mutation("navigate_screen", { screenId: "question1" })
goQuestion2 = Mutation("navigate_screen", { screenId: "question2" })
goResult = Mutation("navigate_screen", { screenId: "result" })
root = AppShell("Quiz", [
  Screen("intro", "Welcome", null, [
    Text("Three quick questions are coming next.", "body", "start"),
    Button("Start", "default", Action([@Run(goQuestion1)]), false)
  ]),
  Screen("question1", "Question 1", null, [
    RadioGroup("answer", "Pick one answer", "a", [
      { label: "Option A", value: "a" },
      { label: "Option B", value: "b" }
    ], null),
    Group(null, null, "horizontal", [
      Button("Next", "secondary", Action([@Run(goQuestion2)]), false, "next-question1"),
      Button("Back", "ghost", Action([@Run(goIntro)]), false, "back-question1")
    ])
  ]),
  Screen("question2", "Question 2", null, [
    RadioGroup("answer", "Pick another answer", "a", [
      { label: "Option A", value: "a" },
      { label: "Option B", value: "b" }
    ], null),
    Group(null, null, "horizontal", [
      Button("Next", "secondary", Action([@Run(goResult)]), false, "next-question2"),
      Button("Back", "ghost", Action([@Run(goQuestion1)]), false, "back-question2")
    ])
  ]),
  Screen("result", "Result", null, [
    Text("Show result screen after the last question.", "title", "start"),
    Button("Restart", "ghost", Action([@Run(goIntro)]), false)
  ])
])`,
  ],
  additionalRules: [
    'Return only raw OpenUI Lang source. Do not wrap it in markdown, prose, or code fences.',
    'Return the full updated program every time, not a patch.',
    'The root statement must be `root = AppShell(...)`.',
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
    'When multiple Button components share the same label, pass a stable id as the final Button argument so button state and actions do not collide.',
    'Every referenced identifier must be defined in the final source exactly once. Never leave unresolved references such as @Run(deleteTodo) without a matching statement.',
    'Before returning, mentally verify every Repeater(...), @Run(...), component reference, and statement identifier so the program has zero unresolved references.',
    'Generated apps must stay browser-safe and must not depend on server-side execution after generation.',
    'Support flows involving text fields, collections, buttons, local state, and filtering or conditional rendering when the user asks for them.',
  ],
});

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
  return systemPrompt;
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
