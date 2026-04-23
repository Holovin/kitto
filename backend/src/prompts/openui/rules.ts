import { detectPromptIntents, type PromptIntentVector } from './promptIntents.js';

export const BUTTON_APPEARANCE_RULE =
  'For any `Button` variant with appearance, background uses mainColor and text uses contrastColor.';

const SIMPLE_APP_RULES = [
  'SIMPLE APP RULE:',
  'Prefer the smallest working app that satisfies the latest user request.',
  'Do not add extra screens, filters, themes, validation, due dates, compute tools, or persisted fields unless the user asks for them.',
  'For simple apps, use one Screen and one or two Groups.',
  'If the user asks to create an app, do not return explanatory placeholder screens. Build the actual interactive UI.',
] as const;

const CORE_PROGRAM_RULES = [
  'Return the full updated program every time, not a patch.',
  'The root statement must be `root = AppShell([...])`.',
  'AppShell must be the single root statement; never nest AppShell and never define a second AppShell anywhere else in the source.',
  'Use only the supported components and tools provided in this prompt.',
  'Use only documented shallow objects:',
  '- appearance objects',
  '- tool argument objects',
  '- compute options',
  '- validation rule objects',
  'Do not invent any other nested config objects.',
] as const;

const GENERAL_CONTROL_ACTION_MODE_RULES = [
  'Checkbox supports two modes: use `$binding<boolean>` for local form state, or pass a display-only boolean plus `Action([...])` for explicit persisted row toggles.',
  'RadioGroup and Select also support action mode: use a display-only string plus `Action([...])` when the newly chosen option should trigger a persisted update instead of local form binding.',
  'RadioGroup/Select options must be `[{ label, value }]`, never `["Email", "Phone"]`.',
  'Never combine `action` with a writable `$binding<...>` on Checkbox, RadioGroup, or Select. Action-mode controls take a literal/item-field display value; binding-mode controls take only `$binding`.',
  'When RadioGroup or Select runs in action mode, the runtime writes the newly selected option to `$lastChoice` before the action runs.',
  'Use `$lastChoice` only inside Select/RadioGroup action-mode flows or the top-level Mutation(...) / Query(...) statements those actions run.',
  'Do not read `$lastChoice` directly in Text(...), disabled expressions, or unrelated statements.',
  'For persisted collection row actions, define top-level Mutations such as `append_item`, `toggle_item_field`, `update_item_field`, or `remove_item`, then relay item context through local state inside the row Action.',
  'Collection-item relay recipe: `$targetItemId = ""`, `toggleItem = Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })`, then inside `@Each(...)` use `Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)])`.',
  'Select/RadioGroup action-mode recipe: `savedFilter = Query("read_state", { path: "ui.filter" }, "all")`, `setFilter = Mutation("write_state", { path: "ui.filter", value: $lastChoice })`, then `Select("filter", "Show", savedFilter, filterOptions, null, [], Action([@Run(setFilter), @Run(savedFilter)]))`.',
  'Inside `@Each(collection, "item", ...)`, do not bind `Input`, `TextArea`, `Checkbox`, `RadioGroup`, or `Select` directly to `item.<field>` without an explicit `Action([...])`.',
  'Do not mutate persisted array rows through numeric paths such as `app.items.0`; use `toggle_item_field`, `update_item_field`, or `remove_item` with `idField` + `id`.',
] as const;

const TODO_CONTROL_RULES = [
  'Display-only `Checkbox(item.completed)` does not write back to persisted collections by itself.',
  'For canonical todo rows with interactive completion, use an action-mode `Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))` instead of a read-only status `Text(...)` label.',
] as const;

const LAYOUT_RULES = [
  'LAYOUT RULES:',
  'Use Screen for top-level app sections.',
  'Use at most one Screen unless the user asks for a wizard, quiz, onboarding, or multi-step flow.',
  'Use Group only for meaningful visual sections.',
  'Do not wrap every individual control in its own Group.',
  'Use Group variant "inline" only for compact rows of buttons, filters, or controls.',
  'For simple todo/list/form apps, avoid deeply nested block Groups.',
  'Use Group for local layout within a Screen.',
  'AppShell signature is `AppShell(children, appearance?)`.',
  'Group signature is `Group(title, direction, children, variant?, appearance?)`.',
  'The second Group argument is direction and must be `"vertical"` or `"horizontal"`.',
  'If you pass a Group variant, place it in the optional fourth argument.',
  'Never put `"block"` or `"inline"` in the second Group argument.',
  'Use Group variant "block" for standalone visual sections.',
  'Do not over-nest block Groups.',
  'Without appearance, button variants keep their semantic fallback styles such as filled, outlined, or destructive.',
] as const;

const TOOL_MINIMALITY_RULES = [
  'TOOL MINIMALITY:',
  'Use $variables for ephemeral UI state.',
  'Use persisted tools only for data that should survive reload/export, such as user-created lists or saved form submissions.',
  'For persisted object rows that will need row actions, prefer `append_item` so each row has a stable `id`; if you pass `value.id`, use a non-empty string or finite number.',
  'Use `toggle_item_field`, `update_item_field`, and `remove_item` for id-based row actions on persisted object collections instead of rebuilding whole arrays manually.',
  'Compute tools are opt-in. Do not use `compute_value` or `write_computed_state` unless the requested task needs them.',
  'Do not use `compute_value` or `write_computed_state` for simple list CRUD, basic screen navigation, filtering, or normal input display.',
] as const;

const APPEARANCE_AND_THEME_RULES = [
  'APPEARANCE / THEME CONTRACT:',
  'When the user asks for a shared light/dark theme, start with `$currentTheme = "light"`, define `lightTheme`, `darkTheme`, `appTheme`, and apply `root = AppShell([...], appTheme)`.',
  'Only introduce `$currentTheme`, `lightTheme`, `darkTheme`, and theme-toggle buttons when the user asks for app-wide light/dark switching or a theme toggle.',
  'If the request is only for color tags, accents, badges, or one-off color changes, use direct `appearance` overrides instead of shared theme state.',
  'Use `activeThemeButton = { mainColor: "#DC2626", contrastColor: "#FFFFFF" }` for the active toggle, `inactiveThemeButton = appTheme` for the inactive toggle, and conditional appearance on the active theme button.',
  'When the goal is one shared theme, do not manually pass `appearance` to every Input, Select, RadioGroup, or other control. Let them inherit from `AppShell(..., appTheme)` first.',
  'Children inherit appearance theme pairs from parent AppShell, Screen, Group, or Repeater containers.',
  'Use local `appearance` only when a specific subtree or control needs an override on top of the shared theme.',
  'Use `appearance` for visual color changes.',
  'Use `appearance.mainColor` and `appearance.contrastColor` only.',
  'appearance.mainColor is the main theme surface color, usually the background for containers.',
  'appearance.contrastColor is the contrasting text or primary action color.',
  'Text supports only `appearance.contrastColor`. Do not pass `appearance.mainColor` to Text.',
  'Only use #RRGGBB colors.',
  'Use conditional appearance for active or selected buttons instead of inventing activeColor props.',
  BUTTON_APPEARANCE_RULE,
  'Do not use CSS, className, style objects, named colors, rgb(), hsl(), var(), url(), or arbitrary layout styling.',
  'Local appearance overrides inherited theme colors, and buttons use the same main/background + contrast/text mapping as other controls.',
  'Variants are fallback styles, not the primary mechanism for theme switching.',
] as const;

const COLLECTION_RULES = [
  'Use Repeater only for dynamic or generated collections. Static one-off content should be written directly as normal nodes.',
  'Repeater renders an array of already-built row nodes. Build those rows with `@Each(collection, "item", rowNode)` before passing them to Repeater.',
  'When the user asks for selected answers, saved items, cards, results, or any other data-driven list, derive rows from local arrays, runtime state, or Query("read_state", ...) data instead of hardcoding repeated values.',
  'If collection data is persisted browser data, read it through Query("read_state", { path: "..." }, defaultValue) before passing it to @Each(...).',
  'Even when the current data may contain only one row, keep requested lists modeled as collections with @Each(...) + Repeater(...).',
  'Do not hardcode answer rows, card rows, or summary lines when the list should reflect dynamic data.',
  'Prefer `append_item` over `append_state` when persisted object rows need stable ids.',
  'Use `toggle_item_field` for booleans such as `completed`, `done`, `selected`, or `archived` on persisted rows.',
  'Use `update_item_field` for direct row edits such as renaming a task or updating one note/status field.',
  'Use `remove_item` for id-based deletion of persisted object rows.',
] as const;

const FILTER_RULES = [
  'Prefer built-in collection helpers such as `@Filter(collection, field, operator, value)` and `@Count(collection)` for derived filtered views and counts.',
  'Use `@Filter(collection, field, operator, value)` with a field string and comparison operator; do not invent predicate-form filters or JavaScript callbacks.',
  'When the user asks for all, active, completed, or similar filtered views of one collection, keep one source collection and derive the visible collection with `@Filter(...)` instead of inventing a new tool.',
  'Expressions are allowed inside the source argument to `@Each(...)`, so you may pass either a named derived collection or an inline filtered expression.',
  'Do not invent custom filtering tools, todo-specific tool names, or special collection helpers when built-in functions already cover the request.',
] as const;

const INPUT_AND_VALIDATION_RULES = [
  'Use `Checkbox(..., validation)` with a writable `$binding<boolean>` for agreement, consent, confirmation, or acknowledgement fields backed by local form state.',
  'Use Checkbox action mode with a display-only boolean plus `Action([...])` when the checkbox itself should trigger a persisted row toggle.',
  'Use RadioGroup or Select action mode with a display-only string plus `Action([...])` when the choice itself should trigger a persisted update.',
  'Input supports these HTML types only: `"text"`, `"email"`, `"number"`, `"date"`, `"time"`, `"password"`.',
  'Use `Input(name, label, value, placeholder?, helper?, type?, validation?, appearance?)` with explicit input types for semantic fields instead of inventing custom components.',
  'Use `Input` type `"date"` for due dates, deadlines, birthdays, and scheduled dates.',
  'Use `Input` type `"number"` for quantity, count, amount, or other numeric fields.',
  'When the user gives numeric bounds such as minimums or maximums, add matching `minNumber` and `maxNumber` validation rules.',
  'Use `Input` type `"email"` for email fields and pair it with `email` validation when the field must contain a valid email address.',
  'Use `Checkbox(..., validation)` with a `required` rule for agreement, consent, confirmation, or acknowledgement fields.',
  'Input values always stay strings. Number inputs must stay strings in runtime state unless a tool explicitly converts them.',
  'Date inputs store strict `YYYY-MM-DD` strings, and time inputs store browser-style `HH:mm` strings.',
  'For due dates, store values as `YYYY-MM-DD` strings.',
  'Use declarative validation rules only: `[{ type: "required", message: "..." }]`.',
  'Supported validation rules are `required`, `minLength`, `maxLength`, `minNumber`, `maxNumber`, `dateOnOrAfter`, `dateOnOrBefore`, and `email`.',
  'Never generate JavaScript validators, regex validators, Function constructors, eval, or script-like validation code.',
  'Only use validation rules that match the component and input type.',
  'For text, textarea, and password fields, use only `required`, `minLength`, and `maxLength`.',
  'For email fields, use only `required`, `minLength`, `maxLength`, and `email`.',
  'For number inputs, use only `required`, `minNumber`, and `maxNumber`.',
  'For date inputs, use only `required`, `dateOnOrAfter`, and `dateOnOrBefore`, and rule values must be literal `YYYY-MM-DD` strings.',
  'For time inputs, selects, and radio groups, use only `required`.',
  'For checkboxes, `required` means the checkbox must be checked.',
] as const;

const SCREEN_AND_COMPONENT_BASE_RULES = [
  'Screen signature is `Screen(id, title, children, isActive?, appearance?)`.',
  'Screen never contains another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
  'Repeater signature is `Repeater(children, emptyText?, appearance?)`.',
  'Repeater never contains another Repeater at any depth. Flatten nested list ideas or use Group inside the row template instead of nesting Repeaters.',
  'Button signature is `Button(id, label, variant, action?, disabled?, appearance?)`.',
  'Omit isActive for always-visible single-screen apps. Pass a boolean expression only when a screen should conditionally render.',
] as const;

const MULTI_SCREEN_RULES = [
  'Use `Screen(id, title, children, isActive?, appearance?)` when you need screen-level sections.',
  'For internal multi-screen flows, declare `$currentScreen = "screen-id"` and switch screens with `@Set($currentScreen, "next-screen-id")`.',
  'Use `$currentScreen` + `@Set(...)` for screen navigation.',
  'Do not use persisted tools for internal screen navigation. Use tools only for exportable or shared domain data.',
] as const;

function buildIntentSpecificRules(intents: PromptIntentVector) {
  return [
    ...SIMPLE_APP_RULES,
    ...CORE_PROGRAM_RULES,
    ...GENERAL_CONTROL_ACTION_MODE_RULES,
    ...(intents.todo ? TODO_CONTROL_RULES : []),
    ...LAYOUT_RULES,
    ...TOOL_MINIMALITY_RULES,
    ...(intents.theme ? APPEARANCE_AND_THEME_RULES : []),
    ...COLLECTION_RULES,
    ...(intents.filtering ? FILTER_RULES : []),
    ...(intents.validation ? INPUT_AND_VALIDATION_RULES : []),
    ...SCREEN_AND_COMPONENT_BASE_RULES,
    ...(intents.multiScreen ? MULTI_SCREEN_RULES : []),
    ...(intents.compute ? COMPUTE_TOOL_RULES : []),
    ...PERSISTED_TOOL_AND_COMPLETENESS_RULES,
  ];
}

const BASE_PROMPT_INTENTS: PromptIntentVector = {
  compute: false,
  filtering: false,
  multiScreen: false,
  random: false,
  theme: false,
  todo: false,
  validation: false,
};

const COMPUTE_TOOL_RULES = [
  'Use Query("read_state", ...) with sensible defaults when reading persisted browser data.',
  'Prefer OpenUI built-ins such as `@Each`, `@Filter`, `@Count`, equality checks, boolean expressions, ternaries, and normal property access when they are enough.',
  'Use `compute_value` only when normal OpenUI expressions are not enough for safe primitive calculations.',
  'Use `write_computed_state` only when an action such as a button should compute and persist a primitive value for later rendering.',
  'Use compute tools only for random numbers, numeric calculations, date comparison, string transformations/checks that normal expressions do not handle, or primitive validation-like checks not covered by built-in validation rules.',
  'Both compute tools return `{ value }`.',
  'CANONICAL BUTTON-TRIGGERED RANDOM / COMPUTE RECIPE:',
  '1. `roll = Mutation("write_computed_state", { path: "app.roll", op: "random_int", ... })`',
  '2. `rollValue = Query("read_state", { path: "app.roll" }, null)`',
  '3. Button action: `Action([@Run(roll), @Run(rollValue)])`.',
  '4. `Text(...)` reads `rollValue`, not the Mutation ref.',
  'For button-triggered random values, use `write_computed_state` with `op: "random_int"`; do not use `Query("compute_value", { op: "random_int" }, ...)` for roll-on-click behavior.',
  'For button-triggered randomness or other persisted compute results, always write to state and re-read with `Query("read_state", ...)`; display the persisted primitive, not a Mutation ref or `mutationRef.data.value`.',
  'Date compute operations only accept strict YYYY-MM-DD strings, and `random_int` only accepts integer min/max options.',
] as const;

const PERSISTED_TOOL_AND_COMPLETENESS_RULES = [
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
] as const;

export function buildAdditionalRulesForPrompt(prompt: string | undefined) {
  const intents = typeof prompt === 'string' && prompt.trim().length > 0 ? detectPromptIntents(prompt) : BASE_PROMPT_INTENTS;

  return buildIntentSpecificRules(intents);
}
