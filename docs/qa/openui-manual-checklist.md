# Kitto OpenUI Manual Checklist

## API contract

Supported API:

- `GET /api/health`
- `GET /api/config`
- `POST /api/llm/generate`
- `POST /api/llm/generate/stream`

Guardrails:

- oversized raw `/api/llm/*` request bodies must fail with JSON `413` `validation_error`
- frontend submit-time preflight must block requests whose serialized payload already exceeds `GET /api/config` `limits.requestMaxBytes`, show one clear builder error, and avoid sending that oversized request; the backend `413` limit remains the security boundary
- backend model output above the configured byte limit must fail with a controlled `upstream_error`
- when structured output is enabled, malformed JSON envelopes, missing `source`, empty `source`, invalid optional `summary` / `notes`, or extra envelope fields must fail as controlled errors instead of reaching the OpenUI parser
- `GET /api/config` must expose both frontend-safe request limits and the stream timeout policy used by the builder UI

## Runtime invariants

- Preview renders committed source only.
- While generation is in progress, Preview keeps that committed source (or empty state) visible behind a semi-transparent blocking overlay with a spinner and contextual status label: `Generating...` for the first prompt, `Updating...` for follow-up edits.
- Every generation ends in exactly one terminal state: committed, failed, or cancelled. The builder must never remain stuck in `Generating...` or `Updating...` indefinitely.
- Definition may show streamed draft text while generation is still in progress, but with structured output enabled it must render only the parsed partial OpenUI `source`, not the raw JSON envelope.
- While a structured generation is still in progress, chat should show a single pending assistant summary derived from the streamed envelope as soon as `summary` becomes available.
- After a successful commit, that summary should remain in chat as a normal assistant message and stay eligible for future LLM context unless it is explicitly marked otherwise.
- Valid but over-complex committed drafts may surface non-blocking Definition warnings for unrequested complexity such as extra screens, themes, filters, validation rules, compute tools, or excessive block groups.
- Todo/task-list requests that commit without the minimum todo controls must surface the non-blocking Definition warning `Todo request did not generate required todo controls.`.
- Trivial parser issues that carry deterministic local `suggestion` patches may be auto-fixed in the builder before any repair request is sent.
- Those quality warnings must not trigger auto-repair, reject the draft, or block commit/history updates.
- Blocking product-quality issues may trigger one automatic repair attempt before commit even when the draft is syntactically valid.
- If local suggestion patches make the draft valid again, commit that locally fixed source directly and do not trigger the repair request path for those issues.
- If a generation fails because the model keeps returning invalid OpenUI, both Preview and Definition must snap back to the last committed valid source as if the failed run never committed.
- Invalid source is never committed to Preview or builder history.
- That invalid-generation chat failure must end with: `An error occurred, a new version was not created. Please try rephrasing your request and run it again.`
- After that generation failure, an empty composer shows an enabled `Repeat` primary action that resubmits the last failed prompt.
- Typing any new prompt into the composer changes that primary action back to `Send` immediately.
- If a rejected cached/imported definition is visible and there is no committed preview source to fall back to, Preview shows `Preview is unavailable` with a light error treatment instead of the normal empty state.
- Frontend stream idle timeout or max-duration timeout must abort the in-flight request, surface a controlled failure message, and keep the last committed Preview visible.
- Preview runtime issues reflect the current committed preview only and clear after a different valid committed source replaces the crashing one.
- Rejected imported source in Definition must not mix in stale runtime issues from the previous committed preview.
- Renderer/component exceptions inside Preview or `/elements` demos must stay contained to a local fallback UI instead of crashing the surrounding shell or route.
- Input-like components validate locally on change, blur, and submit-like primary button interactions.
- Validation error text renders below the relevant control and overrides helper text while the error is visible.
- Buttons are not globally auto-disabled by validation; any disabled state must still be expressed explicitly in generated OpenUI.
- Invalid or unsupported validation config must fail safely through parser/runtime issues and must not crash the app.
- Stale streamed chunks and stale non-streaming fallback responses are ignored and must never overwrite a newer generation request.
- Intentional aborts, including clicking `Cancel` or leaving `/chat` mid-generation, clear the in-progress request without appending a red chat error or committing partial source.
- Starting a valid JSON import during an active generation also counts as an intentional abort: the in-flight request is cancelled, the import wins, and any late generation response is ignored.
- Undo, redo, and builder reset also stay available during generation; each must abort the active request first, apply the requested snapshot change, and ignore any late response from the cancelled run.
- Invalid import keeps the last committed Preview/runtime/domain state and only surfaces the rejected source in Definition with parse issues.
- Invalid import surfaces one clear failure status message instead of duplicate import errors.
- Reload restores the last committed Preview source together with the current live runtime state, persisted domain data, and undo/redo history.
- The chat toolbar shows `Version: N / M` before the previous-version and next-version buttons, where `N` counts committed non-empty versions and may be `0` after undoing back to a blank canvas with history still available.
- A pristine blank builder with no committed version history shows `—` in the chat toolbar.
- Undo/redo keep a single rewind-status system chat message and update it in place rather than stacking multiple rewind notices.
- The rewind-status system chat message includes the same visible version number shown in the toolbar.
- `Reset` stays enabled whenever any committed version history exists, including the `0 / M` state after undoing back to a blank canvas.
- `Reset` is disabled only in the pristine empty builder state immediately after a fresh open or after `Reset`.
- `Reset` stays enabled whenever committed preview content exists, version history exists, or a rejected cached/imported definition is visible.
- Internal preview clicks do not call the LLM; only chat submissions should hit `/api/llm/*`.
- Standalone HTML export always uses the committed source and the committed snapshot baseline runtime/domain state, not the builder’s current live clicked state.
- Standalone HTML files run without the Kitto shell, backend, OpenAI config, or `/api/*` requests.
- Standalone HTML files persist their own runtime/domain state in localStorage and can reset back to the embedded baseline state.
- Each standalone HTML export gets its own localStorage namespace, even when two downloads use the same committed source.
- When a standalone HTML file is opened from `file://`, root-relative app paths such as `/chat` and hash/self links such as `#details` must be treated as invalid/inert instead of attempting local filesystem navigation.
- `toolProvider` is only used by `Query(...)` and `Mutation(...)`.
- Allowed tool names are `read_state`, `compute_value`, `write_state`, `merge_state`, `append_state`, `append_item`, `toggle_item_field`, `update_item_field`, `remove_item`, `remove_state`, and `write_computed_state`.
- Persisted tool paths must be non-empty dot-paths no deeper than 10 segments.
- Persisted path segments may use only letters, numbers, `_`, or `-`, and must reject `__proto__`, `prototype`, and `constructor`.
- Numeric path segments are valid only when they address array indexes.
- `write_state` and `append_state` values must stay JSON-compatible, `append_item` values must be plain objects, `update_item_field` values must stay JSON-compatible, `merge_state` patches must stay plain objects, and `remove_state` requires an explicit non-negative integer `index`.
- Collection-item tool field names such as `idField` and `field` must be safe single keys only and must reject `__proto__`, `prototype`, and `constructor`.
- `compute_value` and `write_computed_state` must return `{ value }`, where `value` is always a primitive string, number, or boolean.
- Prefer OpenUI built-ins such as `@Each`, `@Filter`, `@Count`, equality checks, boolean expressions, ternaries, and normal property access before reaching for compute tools.
- `write_computed_state` must validate the target persisted path using the same hardened rules as other persisted state tools.
- Mutation statement refs are status objects. Do not render them directly into `Text(...)`; for visible compute results, write to persisted state and re-read through `Query("read_state", ...)` instead of relying on the raw mutation object.
- Date compute operations accept only strict `YYYY-MM-DD` strings; natural-language dates and datetimes are invalid.
- `random_int` uses integer `min` / `max` options only and must stay inside the clamped safe range.
- Invalid tool arguments must surface as runtime/tool issues without crashing the app or mutating persisted data.
- `@OpenUrl` is handled through the OpenUI built-in action event bridge, not through persisted tools.
- `Link(...)` and `@OpenUrl(...)` must share the same URL allowlist: `https:`, `http:`, `mailto:`, `tel:`, app-relative `/...`, and hash links `#...`; when running from `file://` standalone export, app-relative and hash/self links must become inert.
- `Link(...)` must render inert text instead of an anchor when the URL is empty, malformed, or uses blocked schemes such as `javascript:`, `data:`, or `blob:`.
- `@OpenUrl(...)` must ignore empty, malformed, or blocked URLs without throwing.
- Screen navigation uses local state such as `$currentScreen` with `@Set(...)`.
- Persisted tools are for exportable/shared domain data, not internal screen navigation.

## Prompt and component contract

Root:

```txt
root = AppShell([...])
```

AppShell theme:

```txt
AppShell(children, appearance?)
```

Button:

```txt
Button(id, label, variant, action?, disabled?, appearance?)
```

Screen:

```txt
Screen(id, title, children, isActive?, appearance?)
```

Group:

```txt
Group(title, direction, children, variant?, appearance?)
```

Variants:

```txt
block | inline
```

Default:

```txt
block
```

Simple-app bias:

```txt
Prefer the smallest working app that satisfies the latest user request.
Do not add extra screens, filters, themes, validation, due dates, compute tools, or persisted fields unless the user asks for them.
For simple apps, use one Screen and one or two Groups.
If the user asks to create an app, do not return explanatory placeholder screens. Build the actual interactive UI.
```

Layout simplicity:

- Use `Screen(...)` for top-level app sections.
- Use at most one `Screen(...)` unless the user asks for a wizard, quiz, onboarding, or multi-step flow.
- Use `Group(...)` only for meaningful visual sections.
- Do not wrap every individual control in its own `Group(...)`.
- Use `Group(..., "inline")` only for compact rows of buttons, filters, or controls.
- For simple todo/list/form apps, avoid deeply nested block groups.

Documented shallow objects only:

- appearance objects
- tool argument objects
- compute options
- validation rule objects
- do not invent any other nested config objects

Safe color overrides:

```txt
appearance = { mainColor?: "#RRGGBB", contrastColor?: "#RRGGBB" }
Text(value, variant, align, appearance?)
Input(name, label, value?, placeholder?, helper?, type?, validation?, appearance?)
TextArea(name, label, value?, placeholder?, helper?, validation?, appearance?)
Checkbox(name, label, checked?, helper?, validation?, action?, appearance?)
RadioGroup(name, label, value?, options?, helper?, validation?, action?, appearance?)
Select(name, label, value?, options?, helper?, validation?, action?, appearance?)
Link(label, url, newTab?, appearance?)
Repeater(children, emptyText?, appearance?)
```

Typed inputs and declarative validation:

```txt
Input type values: text | email | number | date | time | password
Input default type: text
Input values always stay strings
date values use YYYY-MM-DD
time values use browser HH:mm strings
number values remain strings unless a tool converts them explicitly

validation = [
  { type: "required", message?: string },
  { type: "minLength", value: number, message?: string },
  { type: "maxLength", value: number, message?: string },
  { type: "minNumber", value: number, message?: string },
  { type: "maxNumber", value: number, message?: string },
  { type: "dateOnOrAfter", value: "YYYY-MM-DD", message?: string },
  { type: "dateOnOrBefore", value: "YYYY-MM-DD", message?: string },
  { type: "email", message?: string }
]
```

Validation applicability:

- `Input(type="text")`: `required`, `minLength`, `maxLength`
- `Input(type="email")`: `required`, `minLength`, `maxLength`, `email`
- `Input(type="number")`: `required`, `minNumber`, `maxNumber`
- `Input(type="date")`: `required`, `dateOnOrAfter`, `dateOnOrBefore`
- `Input(type="time")`: `required`
- `Input(type="password")`: `required`, `minLength`, `maxLength`
- `TextArea`: `required`, `minLength`, `maxLength`
- `Select`: `required`
- `RadioGroup`: `required`
- `Checkbox`: `required` only, and `required` means checked must be `true`

Navigation:

```txt
$currentScreen = "intro"
Button("next-button", "Next", "default", Action([@Set($currentScreen, "next")]), false)
```

Simple todo recipe:

```txt
$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No tasks yet.")
  ])
])
```

Todo request guardrails:

- For `todo`, `task list`, `to-do`, or `список задач` requests, the minimum app must include `$draft`, an input, `Query("read_state", { path: "app.items" }, [])`, `Mutation("append_item", { path: "app.items", value: ... })`, an add button action with `@Run(addItem)` + `@Run(items)` + `@Reset($draft)`, `@Each(items, "item", ...)`, and `Repeater(rows, "No tasks yet.")`.
- Do not return a title-only, explanatory, or placeholder-only screen for a todo/task list request.
- If a simple todo request misses that minimum structure, repair before commit instead of committing the placeholder draft.
- For a simple todo app, do not add theme toggles, filters, due dates, compute tools, or extra fields unless the prompt explicitly asks for them.
- `Checkbox(...)` supports two modes: use a writable `$binding<boolean>` for local form state, or pass a display-only boolean plus `Action([...])` for explicit persisted row toggles.
- Do not combine checkbox action mode with a writable `$binding<boolean>` on the same control.
- Display-only `Checkbox(item.completed)` does not write back to persisted collections by itself.
- `RadioGroup(...)` and `Select(...)` also support action mode: use a display-only string plus `Action([...])` when the chosen option should trigger a persisted update instead of local form binding.
- In `RadioGroup` / `Select` action mode, the runtime writes the newly selected option to reserved `$lastChoice` before the action runs.
- Use `$lastChoice` only inside `RadioGroup` / `Select` action-mode flows or the top-level `Mutation(...)` / `Query(...)` statements those actions run. Do not render it directly in UI text, disabled expressions, or unrelated statements.
- For persisted collection row actions, define top-level `Mutation(...)` statements such as `append_item`, `toggle_item_field`, `update_item_field`, or `remove_item`, then relay item context through local state inside the row `Action(...)`.

Derived filtering:

```txt
$filter = "all"
items = Query("read_state", { path: "app.items" }, [])
visibleItems = $filter == "completed" ? @Filter(items, "completed", "==", true) : $filter == "active" ? @Filter(items, "completed", "==", false) : items
rows = @Each(visibleItems, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Completed" : "Active", "muted", "start")
], "inline"))
Text("Visible: " + @Count(visibleItems), "muted", "start")
Repeater(rows, "Empty state")
```

Action-mode choice recipe:

```txt
savedFilter = Query("read_state", { path: "ui.filter" }, "all")
setFilter = Mutation("write_state", { path: "ui.filter", value: $lastChoice })
Select("filter", "Show", savedFilter, filterOptions, null, [], Action([@Run(setFilter), @Run(savedFilter)]))
```

Safe compute tools:

```txt
$name = ""
$dueDate = ""
nameValid = Query("compute_value", {
  op: "not_empty",
  input: $name,
  returnType: "boolean"
}, { value: false })

today = Query("compute_value", { op: "today_date", returnType: "string" }, { value: "" })
isOverdue = Query("compute_value", {
  op: "date_before",
  left: $dueDate,
  right: today.value,
  returnType: "boolean"
}, { value: false })

roll = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 100 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)
Button("roll-button", "Roll", "default", Action([@Run(roll), @Run(rollValue)]), false)
Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
```

Compute tool rules:

- treat `compute_value` and `write_computed_state` as opt-in tools, not defaults
- do not use compute tools for simple list CRUD, basic screen navigation, filtering, or normal input display
- use compute tools only for random numbers, numeric calculations, date comparison, string transformations/checks that normal expressions do not handle, or primitive validation-like checks not covered by built-in validation rules
- for button-triggered random values, use `write_computed_state` with `op: "random_int"`
- do not use `Query("compute_value", { op: "random_int" }, ...)` for roll-on-click behavior
- for button-triggered randomness or other persisted compute results, always write to state and re-read with `Query("read_state", ...)`
- do not expect a mutation result object to automatically refresh visible text
- do not render the raw mutation object into `Text(...)`; it can show up as `[object Object]`

Do use:

- the smallest working app that satisfies the latest user request
- one `Screen(...)` and one or two `Group(...)` sections for simple apps
- `Screen(...)` for screen-level sections and `Group(...)` for local layout
- `Group(..., "block")` for standalone visual sections
- `Group(..., "inline")` for compact rows of buttons, filters, or controls
- `AppShell(..., appearance?)` first when the request is about one shared theme or dark mode
- for light/dark theme toggles, prefer the canonical recipe with `$currentTheme`, `lightTheme`, `darkTheme`, `appTheme`, `activeThemeButton`, `inactiveThemeButton`, and `root = AppShell([...], appTheme)`
- `Screen(...)`, `Group(...)`, and `Repeater(...)` appearance overrides when a subtree needs different inherited colors
- `appearance.mainColor` for the main surface or background color
- `appearance.contrastColor` for text or the contrasting action color
- only strict `#RRGGBB` values such as `#111827`, `#F9FAFB`, or `#2563EB` inside `appearance`
- `Input(..., ..., ..., ..., ..., "date", validation)` for due dates, deadlines, birthdays, and scheduled dates
- `Input(..., ..., ..., ..., ..., "number", validation)` for quantity, count, amount, and other numeric fields while keeping the runtime value as a string
- `Input(..., ..., ..., ..., ..., "email", validation)` for email fields, together with `email` validation when the field must contain a valid address
- `Checkbox(..., validation)` with a writable `$binding<boolean>` and `required` for agreement, confirmation, consent, and acknowledgement fields
- `Checkbox(..., item.completed, ..., Action([...]))` for persisted row toggles when the checkbox itself should trigger the mutation flow
- declarative validation arrays only, using supported rule names and type-appropriate rules
- `Text(...)` only with `appearance.contrastColor`; never `Text(..., { mainColor: ... })`
- `Button(..., "default", ...)` when the primary action should invert the theme pair automatically
- `Button(..., "secondary", ...)` when the button should stay on the normal theme pair
- conditional `appearance` such as `{ mainColor: "#FFFFFF", contrastColor: "#DC2626" }` for an active red theme toggle, with the inactive toggle falling back to `appTheme`
- do not manually pass the same `appearance` to every `Input`, `Select`, `RadioGroup`, or other control when the goal is one shared app theme
- local control `appearance` only when a specific control must override the inherited theme
- conditional `appearance` for active buttons or selected theme toggles
- existing variants first when they already express the requested visual treatment
- parent `AppShell`, `Screen`, `Group`, and `Repeater` appearance values recolor nested controls automatically
- avoid over-nesting block groups
- `Repeater(...)` only for dynamic or generated collections, with rows built via `@Each(...)`
- `@Filter(...)` and `@Count(...)` built-ins for derived filtered collections and counts
- `compute_value` only when the requested task truly needs computation beyond normal OpenUI expressions
- `write_computed_state` only when a button should compute and persist a primitive value
- `write_computed_state` with `op: "random_int"` for button-triggered random values
- local `$variables` for ephemeral UI state such as draft inputs, filters, and internal screen flow
- local arrays for runtime-only collections such as selected answers, and `Query("read_state", ...)` for persisted collections
- `Query("read_state", ...)` with a sensible default when reading persisted data
- persisted tools only for data that should survive reload/export, such as user-created lists or saved form submissions
- `Mutation(...)` with `write_state`, `merge_state`, `append_state`, `append_item`, `toggle_item_field`, `update_item_field`, `remove_item`, `remove_state`, or `write_computed_state` for exportable persistent data
- top-level `Query(...)` and `Mutation(...)` statements referenced later via named refs such as `@Run(saveItem)` or `savedItems`
- for row-level actions, relay item context through local state first, for example `Action([@Set($targetId, item.id), @Run(saveItem), @Run(items)])`
- after every persisted `Mutation(...)` that affects visible UI, re-run later in the same `Action(...)` at least one matching `Query("read_state", ...)`
- treat a `Query("read_state", ...)` as matching when it reads the same path, a parent path, or a child path of the mutation path
- if a persisted mutation affecting visible UI lacks that later refresh query, repair before commit instead of committing a stale visible flow
- `Action([@Run(addTask), @Run(tasks), @Reset($draft)])` for create-and-refresh flows
- `Action([@Run(roll), @Run(rollValue)])` for button-triggered persisted compute flows
- if a random/roll request lacks the persisted compute recipe, repair before commit instead of committing a draft where the result cannot become visible
- if a theme-switch request introduces theme state but container `appearance` does not depend on it, repair before commit instead of committing a non-functional theme toggle
- stable string ids as the first argument of every `Button(...)`

Do not use:

- markdown code fences around generated OpenUI source
- `Screen(..., null, ...)` for the required title argument
- persisted tools for internal screen navigation
- extra screens, filters, themes, validation, due dates, compute tools, or persisted fields unless the user asks for them
- raw CSS, `style`, `className`, named colors, `rgb()`, `hsl()`, `var()`, `url()`, or arbitrary layout styling props
- `textColor`, `bgColor`, `color`, `background`, `surface`, `border`, `accent`, `primaryColor`, or other invented appearance keys
- invented nested config objects beyond appearance objects, tool argument objects, compute options, and validation rule objects
- custom `DateInput` or other custom field components when `Input(..., type, validation)` already covers the request
- JavaScript validators, regex validators, `eval`, `Function(...)`, or script-like validation logic
- invented filtering tools or todo-specific filter APIs when built-in functions already cover the request
- predicate-form `@Filter(items, "item", item.completed == true)` or any other callback-style filter syntax
- assuming display-only `Checkbox(item.completed)` writes back to persisted todo-row fields without an explicit `Action([...])`
- JavaScript functions, `eval`, `Function(...)`, regex code, script tags, or user-provided code strings
- hardcoded repeated answer rows or card rows when the prompt asks for dynamic list data
- inline `Query(...)` or `Mutation(...)` calls inside `@Each(...)`, `Repeater(...)` children, or component props
- unresolved `@Run(ref)` calls or any other undefined identifiers

## Required generated app coverage

Generated app behaviors that should stay supported:

- text input
- typed `Input(...)` fields for semantic cases such as email, quantity, due date, password, or time
- textarea, select, radio group, or checkbox when the prompt calls for longer input or choices
- declarative local validation on supported input-like components
- buttons with `Action([...])`
- collection rendering via `Repeater`
- dynamic collection rows derived from state, query data, or local arrays instead of hardcoded duplicate content
- derived collection filtering and counts via `@Filter(...)` and `@Count(...)`
- local state via `$variables`
- conditional rendering and/or multi-screen switching

Builder controls that should stay working alongside generated apps:

- import/export
- standalone HTML export
- builder feedback and backend connection notices append as chat history messages at the end of the dialog instead of showing a top feedback banner
- invalid import should show Definition validation issues without replacing the current preview or wiping chat, undo/redo history, runtime state, or persisted data
- undo/redo
- reset

## Acceptance criteria

- QA docs exist in `docs/qa/`.
- `README.md` links to the QA docs.
- The docs reflect the current API, runtime, and prompt/component contract.
