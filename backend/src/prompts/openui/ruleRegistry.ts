import { buildOpenUiComponentSignatureRule, getOpenUiComponentCompactSignature } from './componentSpec.js';
import type { PromptIntentVector } from './promptIntents.js';

export const BUTTON_APPEARANCE_RULE =
  'For any `Button` variant with appearance, background uses mainColor and text uses contrastColor.';
export const RADIO_SELECT_OPTIONS_SHAPE_RULE =
  'RadioGroup/Select options must be arrays of `{ label, value }` objects, never bare string or number arrays such as `["Email", "Phone"]`.';

type OpenUiRuleGroupId =
  | 'appearance-and-theme'
  | 'collection'
  | 'compute-tool'
  | 'control-showcase'
  | 'core-program'
  | 'delete'
  | 'filter'
  | 'general-control-action-mode'
  | 'input-and-validation'
  | 'layout'
  | 'multi-screen'
  | 'persisted-tool-and-completeness'
  | 'random'
  | 'screen-and-component-base'
  | 'simple-app'
  | 'todo-control'
  | 'tool-minimality';

interface OpenUiRuleGroup {
  id: OpenUiRuleGroupId;
  intent?: keyof PromptIntentVector;
  rules: readonly string[];
}

export interface OpenUiCanonicalAppPattern {
  id: string;
  intentVector: Partial<PromptIntentVector>;
  rules: readonly string[];
  title: string;
}

const OPENUI_CANONICAL_APP_PATTERNS: readonly OpenUiCanonicalAppPattern[] = [
  {
    id: 'persisted-todo-list',
    title: 'Persisted todo list',
    intentVector: { todo: true },
    rules: [
      'Use one persisted collection path for tasks, such as `app.todos`, read with `items = Query("read_state", { path: "app.todos" }, [])`.',
      'Declare local UI state up front: `$draft = ""` and `$targetItemId = ""`.',
      'Add rows with `append_item` and a plain object value such as `{ title: $draft, completed: false }`; after add, run the items Query and reset `$draft`.',
      'Toggle completion with `toggle_item_field` using `idField: "id"`, `id: $targetItemId`, and `field: "completed"`.',
      'Render rows as `rows = @Each(visibleItemsOrItems, "item", Group(...))`; keep the row template inline so `item` is in scope.',
      'Inside each row, use action-mode Checkbox with `item.completed` plus `Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)])`; do not bind controls directly to `item.completed`.',
      'Pass built rows to `Repeater(rows, "No tasks yet")`; never pass raw Query data directly to Repeater.',
    ],
  },
  {
    id: 'filtered-todo-list',
    title: 'Filtered todo list',
    intentVector: { todo: true, filtering: true },
    rules: [
      'Use the persisted todo list pattern, then derive the visible collection before rendering rows.',
      'For all/active/completed filters, keep one source `items` collection and derive `visibleItems = $filter == "active" ? @Filter(items, "completed", "==", false) : $filter == "completed" ? @Filter(items, "completed", "==", true) : items`.',
      'For search, use `@Filter(items, "title", "contains", $query)` or combine search with status by naming each derived collection.',
      'Render only the derived collection: `rows = @Each(visibleItems, "item", Group(...))`, then `Repeater(rows, "No matching tasks")`.',
      'Keep filter controls in local state such as `$filter` or `$query` unless the user explicitly asks for persisted filter preferences.',
    ],
  },
] as const;

const OPENUI_RULE_GROUPS: readonly OpenUiRuleGroup[] = [
  {
    id: 'simple-app',
    rules: [
      'SIMPLE APP RULE:',
      'Prefer the smallest working app that satisfies the latest user request.',
      'Do not add extra screens, filters, themes, validation, due dates, compute tools, or persisted fields unless the user asks for them.',
      'For simple apps, use one Screen and one or two Groups.',
      'If the user asks to create an app, do not return explanatory placeholder screens. Build the actual interactive UI.',
      'For simple counters, use local state such as `$count = 0` and buttons with `@Set($count, $count + 1)`. Use persisted tools for counters only when the user explicitly asks for reload/export persistence.',
    ],
  },
  {
    id: 'core-program',
    rules: [
      'Return the full updated program every time, not a patch.',
      'The root statement must be `root = AppShell([...])`.',
      'Define `$state`, collections, derived values, Query/Mutation refs, and reusable component refs as top-level statements outside AppShell/Screen/Group child arrays.',
      'Component children arrays may contain only component refs or component calls, not declarations such as `$x = ...`, `items = [...]`, or `row = Group(...)`.',
      'AppShell must be the single root statement; never nest AppShell and never define a second AppShell anywhere else in the source.',
      'Use only the supported components and tools provided in this prompt.',
      'Use only documented shallow objects:',
      '- appearance objects',
      '- tool argument objects',
      '- compute options',
      '- validation rule objects',
      'Do not invent any other nested config objects.',
    ],
  },
  {
    id: 'general-control-action-mode',
    rules: [
      'Checkbox supports two modes: use `$binding<boolean>` for local form state, or pass a display-only boolean plus `Action([...])` for explicit persisted row toggles.',
      'RadioGroup and Select also support action mode: use a display-only string plus `Action([...])` when the newly chosen option should trigger a persisted update instead of local form binding.',
      RADIO_SELECT_OPTIONS_SHAPE_RULE,
      'Never combine `action` with a writable `$binding<...>` on Checkbox, RadioGroup, or Select. Action-mode controls take a literal/item-field display value; binding-mode controls take only `$binding`.',
      'BAD/GOOD Checkbox modes: BAD `Checkbox("done", "Done", $done, null, null, Action([@Run(saveDone)]))`; GOOD binding `Checkbox("done", "Done", $done)`; GOOD action `Checkbox("done-" + item.id, "Done", item.done, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))`.',
      'When RadioGroup or Select runs in action mode, the runtime writes the newly selected option to `$lastChoice` before the action runs.',
      'Use `$lastChoice` only inside Select/RadioGroup action-mode flows or the top-level Mutation(...) / Query(...) statements those actions run.',
      'Do not read `$lastChoice` directly in Text(...), disabled expressions, or unrelated statements.',
      'For persisted collection row actions, define top-level Mutations such as `append_item`, `toggle_item_field`, `update_item_field`, or `remove_item`, then relay item context through local state inside the row Action.',
      'Collection-item relay recipe: `$targetItemId = ""`, `toggleItem = Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })`, then inside `@Each(...)` use `Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)])`.',
      'Select/RadioGroup action-mode recipe for persisted choices: `savedPlan = Query("read_state", { path: "ui.plan" }, "basic")`, `savePlan = Mutation("write_state", { path: "ui.plan", value: $lastChoice })`, then `Select("plan", "Plan", savedPlan, planOptions, null, null, Action([@Run(savePlan), @Run(savedPlan)]))`.',
      'Inside `@Each(collection, "item", ...)`, do not bind `Input`, `TextArea`, `Checkbox`, `RadioGroup`, or `Select` directly to `item.<field>` without an explicit `Action([...])`.',
      'Do not mutate persisted array rows through numeric paths such as `app.items.0`; use `toggle_item_field`, `update_item_field`, or `remove_item` with `idField` + `id`.',
    ],
  },
  {
    id: 'todo-control',
    intent: 'todo',
    rules: [
      'Display-only `Checkbox(item.completed)` does not write back to persisted collections by itself.',
      'For canonical todo rows with interactive completion, use an action-mode `Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))` instead of a read-only status `Text(...)` label.',
    ],
  },
  {
    id: 'control-showcase',
    intent: 'controlShowcase',
    rules: [
      'CONTROL SHOWCASE RULE:',
      'When the user asks for every control, all controls, or a component showcase, include at least one Input, TextArea, Checkbox, RadioGroup, Select, Button, and Link in the visible app.',
      'Use normal binding-mode controls for the showcase unless the user asks for persistence.',
      'For Link, provide a safe app-relative or https URL and a visible label.',
    ],
  },
  {
    id: 'layout',
    rules: [
      'LAYOUT RULES:',
      'Use Screen for top-level app sections.',
      'Prefer one Screen for simple apps unless the request naturally needs multiple major sections.',
      'Use Group only for meaningful visual sections.',
      'Do not wrap every individual control in its own Group.',
      'Use Group variant "inline" only for compact rows of buttons, filters, or controls.',
      'For simple todo/list/form apps, avoid deeply nested block Groups.',
      'Use Group for local layout within a Screen.',
      buildOpenUiComponentSignatureRule('AppShell'),
      buildOpenUiComponentSignatureRule('Group'),
      'The second Group argument is direction and must be `"vertical"` or `"horizontal"`.',
      'If you pass a Group variant, place it in the optional fourth argument.',
      'Never put `"block"` or `"inline"` in the second Group argument.',
      'BAD/GOOD Group variant: BAD `Group("x", "block", [Text("Hi", "body", "start")])`; GOOD `Group("x", "vertical", [Text("Hi", "body", "start")], "block")`.',
      'Use Group variant "block" for standalone visual sections.',
      'Do not over-nest block Groups.',
      'Without appearance, button variants keep their semantic fallback styles such as filled, outlined, or destructive.',
    ],
  },
  {
    id: 'tool-minimality',
    rules: [
      'TOOL MINIMALITY:',
      'Use $variables for ephemeral UI state.',
      'Use persisted tools only for data that should survive reload/export, such as user-created lists or saved form submissions.',
      'For persisted object rows that will need row actions, prefer `append_item` so each row has a unique stable `id`; if you pass `value.id`, use a non-empty string or finite number that is not already used by that collection.',
      'Use `toggle_item_field`, `update_item_field`, and `remove_item` for id-based row actions on persisted object collections instead of rebuilding whole arrays manually.',
      'Compute tools are opt-in. Do not use `compute_value` or `write_computed_state` unless the requested task needs them.',
      'Do not use `compute_value` or `write_computed_state` for simple list CRUD, basic screen navigation, filtering, or normal input display.',
    ],
  },
  {
    id: 'appearance-and-theme',
    intent: 'theme',
    rules: [
      'APPEARANCE / THEME CONTRACT:',
      'Follow the Theme toggle pattern for shared light/dark switching: `$currentTheme`, `lightTheme`, `darkTheme`, `appTheme`, active/inactive button appearances, and `root = AppShell([...], appTheme)`.',
      'Only introduce shared theme state and toggles when the user asks for app-wide theme switching; use direct `appearance` overrides for one-off colors, accents, badges, or selected buttons.',
      'Parent AppShell/Screen/Group/Repeater appearances inherit through children; let controls inherit first and use local `appearance` only for a specific subtree/control override.',
      'Use only `appearance.mainColor` and `appearance.contrastColor` as strict #RRGGBB values; Text supports only `appearance.contrastColor`; Button appearance maps mainColor to background and contrastColor to text; never use CSS, className, style, named colors, rgb(), hsl(), var(), url(), or layout styling.',
    ],
  },
  {
    id: 'collection',
    rules: [
      'Use Repeater only for dynamic or generated collections. Static one-off content should be written directly as normal nodes.',
      'Repeater renders an array of already-built row nodes. Build those rows with `@Each(collection, "item", rowNode)` before passing them to Repeater.',
      'BAD/GOOD Repeater data flow: BAD `Repeater(Query("read_state", { path: "app.items" }, []), "No items")`; GOOD `items = Query(...)`, `rows = @Each(items, "item", Group(null, "horizontal", [Text(item.title, "body", "start")], "inline"))`, `Repeater(rows, "No items")`.',
      'When the user asks for selected answers, saved items, cards, results, or any other data-driven list, derive rows from local arrays, runtime state, or Query("read_state", ...) data instead of hardcoding repeated values.',
      'If collection data is persisted browser data, read it through Query("read_state", { path: "..." }, defaultValue) before passing it to @Each(...).',
      'Even when the current data may contain only one row, keep requested lists modeled as collections with @Each(...) + Repeater(...).',
      'Do not hardcode answer rows, card rows, or summary lines when the list should reflect dynamic data.',
      'Prefer `append_item` over `append_state` when persisted object rows need stable ids.',
      'Use `toggle_item_field` for booleans such as `completed`, `done`, `selected`, or `archived` on persisted rows.',
      'Use `update_item_field` for direct row edits such as renaming a task or updating one note/status field.',
      'Use `remove_item` for id-based deletion of persisted object rows.',
    ],
  },
  {
    id: 'filter',
    intent: 'filtering',
    rules: [
      'Prefer built-in collection helpers such as `@Filter(collection, field, operator, value)` and `@Count(collection)` for derived filtered views and counts.',
      'Use `@Filter(collection, field, operator, value)` with a field string and one of these operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, or `contains`; do not invent predicate-form filters or JavaScript callbacks.',
      'BAD/GOOD @Filter syntax: BAD `@Filter(items, item => item.title.contains($query))`; GOOD `@Filter(items, "title", "contains", $query)`.',
      'Use `contains` for simple text search such as `@Filter(items, "title", "contains", $query)`; do not invent `includes`.',
      'Use `>`, `<`, `>=`, and `<=` for numeric values or numeric strings such as `@Filter(items, "score", ">=", 80)`.',
      'When the user asks for all, active, completed, or similar filtered views of one collection, keep one source collection and derive the visible collection with `@Filter(...)` instead of inventing a new tool.',
      'Expressions are allowed inside the source argument to `@Each(...)`, so you may pass either a named derived collection or an inline filtered expression.',
      'Do not invent custom filtering tools, todo-specific tool names, or special collection helpers when built-in functions already cover the request.',
    ],
  },
  {
    id: 'delete',
    intent: 'delete',
    rules: [
      'DELETE / REMOVE RULE:',
      'When removing UI structure such as a screen, field, section, or component from the current app, edit the OpenUI source directly; do not invent persisted tools for UI-only deletion.',
      'For persisted object collection rows, prefer `remove_item(path, idField, id)` with relay state such as `$targetItemId` instead of numeric array paths.',
      'Row delete recipe: `removeItem = Mutation("remove_item", { path: "app.items", idField: "id", id: $targetItemId })`, then inside `@Each(...)` use `Action([@Set($targetItemId, item.id), @Run(removeItem), @Run(items)])`.',
      'After any delete Mutation that affects visible persisted data, re-run the Query that reads that path later in the same Action.',
      'Use `remove_state(path, index)` only when the request clearly targets a numeric array position and the index is explicit; use `remove_item` for id-based object rows.',
    ],
  },
  {
    id: 'input-and-validation',
    intent: 'validation',
    rules: [
      'INPUT / VALIDATION CONTRACT:',
      'Follow the Validation form pattern for typed inputs, local `$binding` state, validation arrays, agreement checkboxes, and a submit button.',
      'Supported Input types are `"text"`, `"email"`, `"number"`, `"date"`, `"time"`, and `"password"`; values stay strings; date/time values stay `YYYY-MM-DD` / `HH:mm`.',
      'Use only declarative validation arrays and supported rules: `required`, `minLength`, `maxLength`, `minNumber`, `maxNumber`, `dateOnOrAfter`, `dateOnOrBefore`, and `email`; never generate JavaScript, regex, eval, or script-like validators.',
      'Match validation rules to the component/type: text/password/textarea use required/minLength/maxLength; email can add email; number uses minNumber/maxNumber; date uses dateOnOrAfter/dateOnOrBefore literal `YYYY-MM-DD`; time/select/radio use required; checkbox required means checked.',
      'For agreement/consent use writable Checkbox plus required validation; for persisted row toggles or saved choice updates use action mode; when skipping validation before action/appearance, pass `null` or `[]` as the validation placeholder.',
    ],
  },
  {
    id: 'screen-and-component-base',
    rules: [
      buildOpenUiComponentSignatureRule('Screen'),
      'Screen never contains another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
      buildOpenUiComponentSignatureRule('Repeater'),
      'Repeater never contains another Repeater at any depth. Flatten nested list ideas or use Group inside the row template instead of nesting Repeaters.',
      buildOpenUiComponentSignatureRule('Button'),
      'Screen is a major visible section, not necessarily a route. Multiple Screen components may be visible at once.',
      'Omit isActive for always-visible screens. Pass a boolean expression only when that section should conditionally render.',
    ],
  },
  {
    id: 'multi-screen',
    intent: 'multiScreen',
    rules: [
      `Use \`${getOpenUiComponentCompactSignature('Screen')}\` when you need screen-level sections.`,
      'Multiple Screen components may be visible at once; use isActive only for sections that are conditionally visible.',
      'For step-by-step flows, declare a local step variable such as `$currentStep = "intro"` and switch conditional sections with `@Set($currentStep, "next-step-id")`.',
      'For step-by-step flows, make sure the initial render has at least one visible Screen.',
      'Do not use persisted tools for internal screen navigation. Use tools only for exportable or shared domain data.',
    ],
  },
  {
    id: 'compute-tool',
    intent: 'compute',
    rules: [
      'COMPUTE TOOL CONTRACT:',
      'Follow the Date comparison pattern or Random dice pattern when the request matches them; otherwise prefer normal OpenUI expressions and built-ins (`@Each`, `@Filter`, `@Count`, arithmetic, comparisons, ternaries, property access) before compute tools.',
      'Use `compute_value` only for safe primitive calculations that expressions cannot cover; use `write_computed_state` only for button-triggered computed values that must persist for later rendering.',
      'Both compute tools return `{ value }`; date compute inputs must be strict `YYYY-MM-DD`; never use compute tools for simple CRUD/list apps, navigation, filtering, or normal input display.',
      '`Query("read_state", ...)` returns the raw persisted value or `null`, not a `{ value }` object. Only `compute_value` and `write_computed_state` return `{ value }`.',
    ],
  },
  {
    id: 'random',
    intent: 'random',
    rules: [
      'CANONICAL BUTTON-TRIGGERED RANDOM / COMPUTE RECIPE:',
      '1. `roll = Mutation("write_computed_state", { path: "app.roll", op: "random_int", ... })`',
      '2. `rollValue = Query("read_state", { path: "app.roll" }, null)`; this reads the raw persisted primitive or `null`.',
      '3. Button action: `Action([@Run(roll), @Run(rollValue)])`.',
      '4. BAD `Text(mutationRef.data.value, "body", "start")`; GOOD `Text(rollValue, "body", "start")` after the button action re-runs `rollValue`.',
      'For button-triggered random values, use `write_computed_state` with `op: "random_int"`; do not use `Query("compute_value", { op: "random_int" }, ...)` for roll-on-click behavior.',
      '`random_int` only accepts integer min/max options.',
    ],
  },
  {
    id: 'persisted-tool-and-completeness',
    rules: [
      'Use write_state, merge_state, append_state, append_item, toggle_item_field, update_item_field, remove_item, remove_state, and write_computed_state for exportable persistent data.',
      'Persisted tool paths must be non-empty dot-paths no deeper than 10 segments.',
      'Each persisted path segment may only use letters, numbers, `_`, or `-`. Numeric segments are array indexes only.',
      'Never use path segments named `__proto__`, `prototype`, or `constructor`.',
      'Item tool field names such as `idField` and `field` must be safe single keys only and must reject `__proto__`, `prototype`, and `constructor`.',
      'write_state and append_state values must stay JSON-compatible, `append_item` values must be plain objects, `update_item_field` values must stay JSON-compatible, and merge_state patches must be plain objects.',
      'remove_state requires an explicit non-negative integer index and only works on existing arrays.',
      'Never generate JavaScript functions, eval, Function constructors, regex code, script tags, or user-provided code strings.',
      'After every Mutation that changes persisted state used by visible UI, re-run later in the same Action at least one Query that reads the same path, a parent path, or a child path.',
      'Todo example: `Action([@Run(addTask), @Run(tasks), @Reset($draft)])`.',
      'Random example: `Action([@Run(roll), @Run(rollValue)])`.',
      'Toggle example: `Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)])`.',
      'Remove example: `Action([@Set($targetItemId, item.id), @Run(removeItem), @Run(items)])`.',
      'Update example: `Action([@Set($targetItemId, item.id), @Run(updateItem), @Run(items)])`.',
      'Every `@Run(ref)` must reference a defined Query or Mutation statement.',
      'Every Button must start with a stable id string so button state and actions stay deterministic.',
      'Every identifier used on the right-hand side of any expression must have a matching top-level `name = ...` definition. Do not reference undefined names.',
      'Every referenced identifier must be defined in the final source exactly once. Never leave unresolved references such as @Run(deleteTodo) without a matching statement.',
      'Before returning, mentally verify every Repeater(...), @Run(...), component reference, and statement identifier so the program has zero unresolved references.',
      'Generated apps must stay browser-safe and must not depend on server-side execution after generation.',
      'Support flows involving text fields, collections, buttons, local state, and filtering or conditional rendering when the user asks for them.',
    ],
  },
] as const;

const OPENUI_RULE_GROUPS_BY_ID = new Map(OPENUI_RULE_GROUPS.map((group) => [group.id, group]));

const STABLE_SYSTEM_RULE_GROUP_IDS: OpenUiRuleGroupId[] = [
  'simple-app',
  'core-program',
  'general-control-action-mode',
  'layout',
  'tool-minimality',
  'collection',
  'screen-and-component-base',
  'persisted-tool-and-completeness',
];

function getRuleGroup(id: OpenUiRuleGroupId) {
  const group = OPENUI_RULE_GROUPS_BY_ID.get(id);

  if (!group) {
    throw new Error(`Unknown OpenUI rule group: ${id}`);
  }

  return group;
}

function flattenRuleGroups(groupIds: OpenUiRuleGroupId[]) {
  return groupIds.flatMap((groupId) => [...getRuleGroup(groupId).rules]);
}

function matchesIntentVector(intents: PromptIntentVector, intentVector: Partial<PromptIntentVector>) {
  return (Object.entries(intentVector) as Array<[keyof PromptIntentVector, boolean]>).every(
    ([intentKey, expectedValue]) => intents[intentKey] === expectedValue,
  );
}

export function buildStableSystemRules() {
  return flattenRuleGroups(STABLE_SYSTEM_RULE_GROUP_IDS);
}

export function getCanonicalAppPatterns() {
  return OPENUI_CANONICAL_APP_PATTERNS;
}

export function buildIntentSpecificRules(intents: PromptIntentVector) {
  const canonicalPatternRules = OPENUI_CANONICAL_APP_PATTERNS.flatMap((pattern) =>
    matchesIntentVector(intents, pattern.intentVector) ? [`CANONICAL APP PATTERN - ${pattern.title}:`, ...pattern.rules] : [],
  );
  const intentSpecificRules = OPENUI_RULE_GROUPS.flatMap((group) => (group.intent && intents[group.intent] ? [...group.rules] : []));

  return [...canonicalPatternRules, ...intentSpecificRules];
}
