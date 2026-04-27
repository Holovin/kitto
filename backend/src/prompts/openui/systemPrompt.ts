import { createHash } from 'node:crypto';
import { BUILTINS, type PromptSpec, type ToolSpec } from '@openuidev/lang-core';
import { openUiComponentSpec, openUiComponentSpecHash } from './componentSpec.js';
import { formatPromptIntentVector, type PromptIntentVector } from './promptIntents.js';
import { buildIntentSpecificRules, buildStableSystemRules } from './ruleRegistry.js';
import { toolSpecifications } from './toolSpecs.js';

interface KittoPromptInput {
  additionalRules: string[];
  componentSpec: PromptSpec;
  examples: string[];
  tools: ToolSpec[];
}

export const OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX = 'kitto:openui';
const OPENUI_SYSTEM_PROMPT_CACHE_TOKEN = 'base';

const preamble =
  'You generate OpenUI Lang for Kitto, a chat-driven browser app builder. Build small frontend-only apps that run entirely in the browser.';
const BASE_PROMPT_INTENTS: PromptIntentVector = {
  compute: false,
  controlShowcase: false,
  delete: false,
  filtering: false,
  multiScreen: false,
  random: false,
  theme: false,
  todo: false,
  validation: false,
};
const BASE_TOOL_NAMES = new Set([
  'read_state',
  'write_state',
  'merge_state',
  'append_state',
  'append_item',
  'toggle_item_field',
  'update_item_field',
  'remove_item',
  'remove_state',
]);
const COMPUTE_TOOL_NAMES = new Set(['compute_value', 'write_computed_state']);

function jsonSchemaTypeStr(schema: unknown): string {
  if (!schema || typeof schema !== 'object') {
    return 'any';
  }

  const typedSchema = schema as {
    additionalProperties?: unknown;
    items?: unknown;
    oneOf?: unknown;
    properties?: Record<string, unknown>;
    required?: string[];
    type?: string;
  };

  if (Array.isArray(typedSchema.oneOf) && typedSchema.oneOf.length > 0) {
    return typedSchema.oneOf.map(jsonSchemaTypeStr).join(' | ');
  }

  if (typedSchema.type === 'string') {
    return 'string';
  }

  if (typedSchema.type === 'number' || typedSchema.type === 'integer') {
    return 'number';
  }

  if (typedSchema.type === 'boolean') {
    return 'boolean';
  }

  if (typedSchema.type === 'array') {
    return `${jsonSchemaTypeStr(typedSchema.items)}[]`;
  }

  if (typedSchema.type === 'object') {
    const properties = typedSchema.properties;

    if (!properties || Object.keys(properties).length === 0) {
      return 'object';
    }

    const required = new Set(typedSchema.required ?? []);
    const entries = Object.entries(properties).map(([key, value]) => {
      const optionalMarker = required.has(key) ? '' : '?';

      return `${key}${optionalMarker}: ${jsonSchemaTypeStr(value)}`;
    });

    return `{${entries.join(', ')}}`;
  }

  return 'any';
}

function defaultForSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') {
    return null;
  }

  const typedSchema = schema as { properties?: Record<string, unknown>; type?: string };

  if (typedSchema.type === 'string') {
    return '';
  }

  if (typedSchema.type === 'number' || typedSchema.type === 'integer') {
    return 0;
  }

  if (typedSchema.type === 'boolean') {
    return false;
  }

  if (typedSchema.type === 'array') {
    return [];
  }

  if (typedSchema.type === 'object') {
    const properties = typedSchema.properties;

    if (!properties || Object.keys(properties).length === 0) {
      return {};
    }

    return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, defaultForSchema(value)]));
  }

  return null;
}

function renderSyntaxRules(rootName: string) {
  return `## Syntax Rules

1. Each statement is on its own line: \`identifier = Expression\`
2. \`root\` is the entry point - every program must define \`root = ${rootName}(...)\`
3. Expressions are: strings ("..."), numbers, booleans (true/false), null, arrays ([...]), objects ({...}), or component calls TypeName(arg1, arg2, ...)
4. Use references for readability: define \`name = ...\` on one line, then use \`name\` later
5. EVERY variable (except root) MUST be referenced by at least one other variable. Unreferenced variables are silently dropped and will NOT render. Always include defined variables in their parent's children/items array.
6. Arguments are POSITIONAL (order matters, not names). Write \`Group("Filters", "horizontal", [child], "inline")\` NOT \`Group("Filters", direction: "horizontal", children: [child])\`; colon syntax is NOT supported and silently breaks
7. Optional arguments can be omitted from the end
8. Declare every state variable as \`$varName = defaultValue\` before first use. Props typed \`$binding<T>\` in signatures accept a \`$varName\` reference for two-way data binding.
9. String concatenation: \`"text" + $var + "more"\`
10. Dot member access: \`query.field\` reads a field; on arrays it extracts that field from every element
11. Index access: \`arr[0]\`, \`data[index]\`
12. Arithmetic operators: +, -, *, /, % (work on numbers; + is string concat when either side is a string)
13. Comparison: ==, !=, >, <, >=, <=
14. Logical: &&, ||, ! (prefix)
15. Ternary: \`condition ? valueIfTrue : valueIfFalse\`
16. Parentheses for grouping: \`(a + b) * c\`
- Strings use double quotes with backslash escaping`;
}

function renderComponentSignatures(spec: PromptSpec) {
  const lines = [
    '## Component Signatures',
    '',
    'Arguments marked with ? are optional. Component arguments are positional.',
    'Props typed `ActionExpression` accept an `Action([@steps...])` expression. See the Action section for available steps.',
    'Props marked `$binding<type>` accept a `$variable` reference for two-way binding.',
  ];

  const renderedComponents = new Set<string>();
  const formatCell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
  const formatComponent = (name: string) => {
    const component = spec.components[name];

    if (!component) {
      return undefined;
    }

    renderedComponents.add(name);

    return `| ${name} | \`${formatCell(component.signature)}\` |`;
  };

  for (const group of spec.componentGroups ?? []) {
    lines.push('', `### ${group.name}`);
    lines.push('', '| Component | Signature |', '| --- | --- |');

    for (const componentName of group.components) {
      const renderedComponent = formatComponent(componentName);

      if (renderedComponent) {
        lines.push(renderedComponent);
      }
    }

    if ((group.notes ?? []).length > 0) {
      lines.push('', ...group.notes.map((note) => `- ${note}`));
    }
  }

  const ungroupedComponents = Object.keys(spec.components).filter((componentName) => !renderedComponents.has(componentName));

  if (ungroupedComponents.length > 0) {
    lines.push('', '### Other');
    lines.push('', '| Component | Signature |', '| --- | --- |');

    for (const componentName of ungroupedComponents) {
      const renderedComponent = formatComponent(componentName);

      if (renderedComponent) {
        lines.push(renderedComponent);
      }
    }
  }

  return lines.join('\n');
}

function renderBuiltInFunctionsSection() {
  const builtinLines = Object.values(BUILTINS).map((builtin) => `@${builtin.signature} - ${builtin.description}`);

  return `## Built-in Functions

Data functions prefixed with \`@\` to distinguish from components. These are the ONLY functions available - do NOT invent new ones.
Use @-prefixed built-in functions (@Count, @Sum, @Avg, @Min, @Max, @Round) on Query results - do NOT hardcode computed values.

${[...builtinLines, '@Each(array, varName, template) - Evaluate template for each element. varName is the loop variable - use it ONLY inside the template expression (inline). Do NOT create a separate statement for the template.'].join('\n')}

Builtins compose - output of one is input to the next:
\`@Count(@Filter(data.rows, "field", "==", "val"))\` for counts, \`@Round(@Avg(data.rows.score), 1)\`, \`@Each(data.rows, "item", Group(null, "horizontal", [Text(item.field, "body", "start")], "inline"))\` for per-item rendering.
Array pluck: \`data.rows.field\` extracts a field from every row; use with @Sum, @Avg, @Min, @Max, or other supported built-ins.

IMPORTANT @Each rule: The loop variable (e.g. "item") is ONLY available inside the @Each template expression. Always inline the template - do NOT extract it to a separate statement.
CORRECT: \`@Each(rows, "t", Group(null, "horizontal", [Button("edit-" + t.id, "Edit", "secondary", Action([@Set($id, t.id)]), false)], "inline"))\`
WRONG: \`rowButton = Button("edit", "Edit", "secondary", Action([@Set($id, t.id)]), false)\` then \`@Each(rows, "t", rowButton)\` - t is undefined in rowButton.`;
}

function renderQuerySection() {
  return `## Query - Live Data Fetching

Read data from available tools. Returns defaults instantly, swaps in real data when it arrives.

\`\`\`
items = Query("tool_name", { arg1: value, arg2: $binding }, { rows: [] }, refreshInterval?)
\`\`\`

- First arg: tool name (string)
- Second arg: arguments object (may reference $bindings; re-fetches automatically on change)
- Third arg: default data rendered immediately before fetch resolves
- Fourth arg (optional): refresh interval in seconds, for example 30
- Use dot access on results: items.rows, profile.name, data.rows.score
- Query results must use regular identifiers: \`items = Query(...)\`, NOT \`$items = Query(...)\`
- Manual refresh: \`Button("refresh", "Refresh", "secondary", Action([@Run(query1), @Run(query2)]), false)\` re-fetches the listed queries`;
}

function renderMutationSection() {
  return `## Mutation - Write Operations

Execute state-changing tool calls. Unlike Query, Mutation fires only when an Action runs it.

\`\`\`
saveItem = Mutation("tool_name", { field: $binding })
\`\`\`

- First arg: tool name (string)
- Second arg: arguments object evaluated with current $binding values at action time
- Mutation refs expose status, data, and error metadata
- Mutation results use regular identifiers: \`saveItem = Mutation(...)\`, NOT \`$saveItem\`
- Show loading state with supported components, for example \`Text(saveItem.status == "loading" ? "Saving..." : "", "muted", "start")\``;
}

function renderActionSection() {
  return `## Action - Control Behavior

Action([@steps...]) wires Button clicks and action-mode controls to operations. Steps execute in order.

Available steps:
- @Run(queryOrMutationRef) - Execute a Mutation or re-fetch a Query
- @Set($variable, value) - Set a $variable to a specific value
- @Reset($var1, $var2, ...) - Reset $variables to their declared defaults
- @ToAssistant("message") - Send a message to the assistant
- @OpenUrl("https://...") - Navigate to a safe URL

Example - mutation + refresh + reset:
\`\`\`
$draft = ""
addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
items = Query("read_state", { path: "app.items" }, [])
Button("add-item", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
\`\`\`

Rules:
- Action can be assigned to a variable or inlined.
- If a @Run(mutation) step fails, remaining steps are skipped.
- @Run(queryRef) re-fetches the query.`;
}

function renderKittoWorkflowSection() {
  return `## Kitto Data Workflow

When persisted browser data is needed:
1. Use Query("read_state", ...) for READ operations that should stay live.
2. Use Mutation(...) for WRITE operations triggered by Action([...]).
3. After a write, re-run the Query that reads the changed path.
4. Use @Each, @Filter, @Count, and other built-ins to derive rendered rows and counts from the Query result.
5. Hardcoded arrays are only for static display data such as labels and options.

RIGHT:
\`\`\`
items = Query("read_state", { path: "app.items" }, [])
visibleItems = @Filter(items, "completed", "==", false)
rows = @Each(visibleItems, "item", Group(null, "horizontal", [Text(item.title, "body", "start")], "inline"))
root = AppShell([Screen("main", "Items", [Repeater(rows, "No items")])])
\`\`\``;
}

function renderToolSignature(tool: ToolSpec) {
  const inputSchema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const properties = inputSchema?.properties ?? {};
  const required = new Set(inputSchema?.required ?? []);
  const args = Object.entries(properties)
    .map(([key, value]) => `${key}${required.has(key) ? '' : '?'}: ${jsonSchemaTypeStr(value)}`)
    .join(', ');
  const returnType = tool.outputSchema ? ` -> ${jsonSchemaTypeStr(tool.outputSchema)}` : '';
  const description = tool.description ? `\n  ${tool.description}` : '';

  return `- ${tool.name}(${args})${returnType}${description}`;
}

function renderAvailableToolsSection(tools: NonNullable<PromptSpec['tools']>) {
  const lines = [
    '## Available Tools',
    '',
    'Use these with Query() for read operations or Mutation() for write operations. The tool list is closed; do not invent tool names.',
    '',
  ];

  for (const tool of tools) {
    lines.push(typeof tool === 'string' ? `- ${tool}` : renderToolSignature(tool));
  }

  const toolsWithOutput = tools.filter((tool): tool is ToolSpec => typeof tool !== 'string' && Boolean(tool.outputSchema));

  if (toolsWithOutput.length > 0) {
    lines.push('', '### Default values for Query results', '', 'Use these shapes as minimal Query defaults:');

    for (const tool of toolsWithOutput) {
      lines.push(`- ${tool.name}: \`${JSON.stringify(defaultForSchema(tool.outputSchema))}\``);
    }
  }

  lines.push(
    '',
    'CRITICAL: Use ONLY the tools listed above in Query() and Mutation() calls. Do NOT invent or guess tool names. If the user asks for functionality that does not match any available tool, use local state or realistic static data instead of fabricating a tool call.',
  );

  return lines.join('\n');
}

function collectToolsByIntents(intents: PromptIntentVector) {
  return toolSpecifications.filter((tool) => {
    if (BASE_TOOL_NAMES.has(tool.name)) {
      return true;
    }

    if ((intents.compute || intents.random) && COMPUTE_TOOL_NAMES.has(tool.name)) {
      return true;
    }

    return false;
  });
}

function renderStatementOrderSection(rootName: string) {
  return `## Hoisting & Statement Order

OpenUI Lang supports hoisting: a reference can be used before it is defined, and the parser resolves references after the full input is parsed.

**Recommended statement order for Kitto:**
1. $variable declarations - state defaults are explicit
2. Query and Mutation statements - tools are named before actions use them
3. Derived collections and reusable component refs - rows and sections stay readable
4. \`root = ${rootName}(...)\` - the single render entry point`;
}

function renderSummaryExamplesSection() {
  return `## Summary Examples

When writing the structured \`summary\`, mention concrete visible behavior instead of generic status text.

- Good: "Added a todo list with task input, completion toggles, and persisted add/remove actions."
- Good: "Converted the flow into a two-screen quiz with answer choices, navigation, and a result view."
- Good: "Added required name and email validation with user-facing helper text on the signup form."
- Bad: "Updated the app."`;
}

function renderImportantRules(rootName: string) {
  return `## Important Rules
- When asked about data, generate realistic/plausible data.
- Choose only supported components that best represent the content: Group/Repeater/Text for structure, Input/TextArea/Checkbox/RadioGroup/Select for controls, Button/Link for actions.

## Final Verification
Before finishing, walk your output and verify:
1. The program defines exactly one \`root = ${rootName}(...)\` statement.
2. Every referenced name is defined. Every defined name other than root is reachable from root.
3. Every Query result is referenced by at least one component.
4. Every $binding appears in at least one component or expression.`;
}

function buildKittoOpenUiCorePrompt({ additionalRules, componentSpec: spec, examples }: Omit<KittoPromptInput, 'tools'>) {
  const rootName = spec.root ?? 'Root';
  const parts = [
    preamble,
    '',
    renderSyntaxRules(rootName),
    '',
    renderComponentSignatures(spec),
    '',
    renderBuiltInFunctionsSection(),
    '',
    renderQuerySection(),
    '',
    renderMutationSection(),
    '',
    renderActionSection(),
    '',
    renderKittoWorkflowSection(),
    '',
    renderStatementOrderSection(rootName),
    '',
    renderSummaryExamplesSection(),
  ];

  if (examples.length > 0) {
    parts.push('', '## Examples', '', ...examples.flatMap((example) => [example, '']));
  }

  parts.push(renderImportantRules(rootName), '', ...additionalRules.map((rule) => `- ${rule}`));

  return parts.join('\n');
}

export function buildOpenUiCoreSystemPrompt() {
  return buildKittoOpenUiCorePrompt({
    additionalRules: buildStableSystemRules(),
    componentSpec: openUiComponentSpec,
    examples: [],
  });
}

export function buildOpenUiIntentSystemPrompt(intents: PromptIntentVector = BASE_PROMPT_INTENTS) {
  const rules = buildIntentSpecificRules(intents);

  if (rules.length === 0) {
    return '';
  }

  return ['## Intent-Specific Rules', ...rules.map((rule) => `- ${rule}`)].join('\n');
}

export function buildOpenUiToolSystemPrompt(intents: PromptIntentVector = BASE_PROMPT_INTENTS) {
  return renderAvailableToolsSection(collectToolsByIntents(intents));
}

export function buildOpenUiLayeredSystemPrompt(intents: PromptIntentVector = BASE_PROMPT_INTENTS) {
  return [
    buildOpenUiCoreSystemPrompt(),
    buildOpenUiIntentSystemPrompt(intents),
    buildOpenUiToolSystemPrompt(intents),
  ]
    .filter(Boolean)
    .join('\n\n');
}

interface CachedSystemPrompt {
  cacheKey: string;
  hash: string;
  prompt: string;
}

const cachedSystemPrompts = new Map<string, CachedSystemPrompt>();

function getCachedSystemPrompt(intents: PromptIntentVector = BASE_PROMPT_INTENTS) {
  const intentVector = formatPromptIntentVector(intents);
  const cacheToken = intentVector === 'base' ? OPENUI_SYSTEM_PROMPT_CACHE_TOKEN : intentVector;
  const cachedPrompt = cachedSystemPrompts.get(cacheToken);

  if (cachedPrompt) {
    return cachedPrompt;
  }

  const prompt = buildOpenUiLayeredSystemPrompt(intents);
  const promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
  const cacheKey = `${OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX}:${cacheToken}:${openUiComponentSpecHash}`;
  const cachedEntry = {
    prompt,
    hash: promptHash,
    cacheKey,
  };

  cachedSystemPrompts.set(cacheToken, cachedEntry);
  return cachedEntry;
}

export function buildOpenUiSystemPrompt() {
  return getCachedSystemPrompt().prompt;
}

export function buildOpenUiSystemPromptForIntents(intents: PromptIntentVector) {
  return getCachedSystemPrompt(intents).prompt;
}

export function getOpenUiSystemPromptCacheKey(intents?: PromptIntentVector) {
  return getCachedSystemPrompt(intents).cacheKey;
}

export function getOpenUiSystemPromptHash(intents?: PromptIntentVector) {
  return getCachedSystemPrompt(intents).hash;
}
