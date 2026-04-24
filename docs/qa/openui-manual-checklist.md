# Kitto OpenUI Manual Checklist

## API contract

Supported API:

- `GET /api/health`
- `GET /api/config`
- `GET /api/prompts/info`
- `POST /api/llm/generate`
- `POST /api/llm/generate/stream`
- `POST /api/llm/commit-telemetry`

Guardrails:

- oversized raw `/api/llm/*` request bodies must fail with JSON `413` `validation_error`
- frontend submit-time preflight must block requests whose serialized payload already exceeds `GET /api/config` `limits.requestMaxBytes`, show one clear builder error, and avoid sending that oversized request; the backend `413` limit remains the security boundary
- backend model output above the configured byte limit must fail with a controlled `upstream_error`
- malformed JSON envelopes, missing required `summary` / `source`, empty `source`, invalid `summary`, or extra envelope fields must fail as controlled errors instead of reaching the OpenUI parser
- `GET /api/config` must expose frontend-safe request limits, the stream timeout policy used by the builder UI, and `repair.maxRepairAttempts`
- `POST /api/llm/generate` and `POST /api/llm/generate/stream` accept raw builder inputs only: the original user prompt, the current committed source, full builder chat history, and repair-only `invalidDraft` plus structured validation issues; the backend filters history and assembles the model-visible initial conversation input plus repair prompt text
- the model envelope schema is `{ summary, source }`, while the backend `POST /api/llm/generate` response and streaming `done` event payload are `{ source, model, temperature, summary, summaryExcludeFromLlmContext?, qualityIssues, compaction? }`
- `POST /api/llm/commit-telemetry` must accept fire-and-forget client commit outcomes only for recently completed generation requests from the same client, validate its JSON body, reject unmatched or overused request ids, and stay separate from import-only local flows

## Prompt docs page

- Open `/elements`, switch to the `Prompts` tab, and verify the page renders the backend config, system prompt, user prompt template, tool specs, repair prompt, and output envelope schema sections.
- Confirm `Output envelope schema` documents the model envelope only (`summary` + `source`) and does not describe the outer backend response payload fields such as `model` or `compaction`.
- Confirm the prompts tab shows the same contents-style table of contents and per-section return-to-top button pattern used by `Elements` / `Actions`.
- Confirm the system-prompt block shows a visible `systemPromptHash`.
- Confirm the `Repair prompt` section explicitly mentions the repair temperature `0.2`.
- Confirm the user prompt template documents the role-based initial input shape: earlier user/assistant turns are sent as separate role-based messages, assistant summaries stay wrapped in `<assistant_summary>`, and the final user turn contains the `<latest_user_request>` and `<current_source>` blocks.
- Confirm the user prompt template says the structured `summary` must describe the visible app/change in 1-2 user-facing sentences and rejects generic phrasing such as `Updated the app`.
- Confirm the repair-prompt block carries the same structured-summary guidance and always instructs the model to return the corrected program in `source`.
- Confirm the repair-prompt block renders backend-owned parser-only, quality-only, and mixed repair examples from the same builder used in production.
- Confirm the prompts tab stays read-only and does not show edit or copy controls.

## Prompt baseline

- Intent-scoped structured system prompt baseline: `systemPromptHash = 98b37736fe6935ce`, `systemPromptCharCount = 32700`.
- This replaces the older documented hash `884ba0033452bf56`.
- Verified on 2026-04-23 from the current prompt builder in the repo.

## Runtime invariants

- Preview renders committed source only.
- After the initial health check resolves, the builder shell must stay usable even if `GET /api/config` is still loading or has failed.
- While `GET /api/config` is unresolved or failed, chat send stays disabled with an explicit composer hint, while import, undo/redo history, committed Preview, and `/elements` remain available.
- The header does not show a runtime-config status badge. While `GET /api/config` is loading, the composer hint explains that chat send is waiting; when it fails, Chat shows one red system message: `Runtime config is unavailable. Chat send is disabled until /api/config can be loaded.`
- While generation is in progress, Preview keeps that committed source (or empty state) visible behind a semi-transparent blocking overlay with a spinner and contextual status label: `Generating...` for the first prompt, `Updating...` for follow-up edits.
- Every generation ends in exactly one terminal state: committed, failed, or cancelled. The builder must never remain stuck in `Generating...` or `Updating...` indefinitely.
- Structural nesting is hard-invalid: keep exactly one `root = AppShell([...])` statement, never nest `AppShell(...)`, never put `Screen(...)` inside another `Screen(...)`, and never put `Repeater(...)` inside another `Repeater(...)`.
- `Group(...)` inside `Group(...)` remains valid and should not be flagged on its own.
- Definition may show streamed draft text while generation is still in progress, but it must render only the parsed partial OpenUI `source`, not the raw JSON envelope.
- While a generation is still in progress, chat should show a single pending assistant summary derived from the streamed envelope as soon as `summary` becomes available.
- Streaming `chunk` events reflect the in-progress model envelope; only the final `done` event carries the backend response payload with `model`, prompt-aware `qualityIssues`, and optional `summaryExcludeFromLlmContext` / `compaction`.
- When the backend compacts oversized chat history for an initial generation request, it should prefer keeping the earliest retained user request plus the newest retained context instead of collapsing to a newest-only tail when both cannot fit.
- After a successful commit, that summary should remain in chat as a normal assistant message and stay eligible for future LLM context unless it is explicitly marked otherwise.
- Committed assistant summaries that stay in LLM context should describe concrete user-visible changes; generic status-only summaries such as `Updated the app` or `Made the requested changes` should not survive as context.
- Valid but over-complex committed drafts may surface non-blocking Definition warnings for unrequested complexity such as extra screens, themes, filters, validation rules, compute tools, or excessive block groups, based on backend prompt-aware quality analysis merged with local source validation.
- Todo/task-list requests that commit without the minimum todo controls must surface the non-blocking Definition warning `Todo request did not generate required todo controls.` when backend prompt-aware quality validation classifies it as a warning instead of a blocker.
- Those quality warnings must not trigger auto-repair, reject the draft, or block commit/history updates.
- Blocking product-quality issues may trigger one automatic repair attempt before commit even when the draft is syntactically valid.
- When an automatic repair request is in flight, chat should show one info-status message indicating that the builder is repairing the draft automatically and remove that pending status once the repair resolves.
- `control-action-and-binding` for `Checkbox`, `RadioGroup`, or `Select` is a blocking product-quality issue: send one repair attempt first, then fail cleanly with `Repeat` if the repaired draft still returns the same issue.
- `reserved-last-choice-outside-action-mode` is also a blocking product-quality issue: send one repair attempt first, then fail cleanly with `Repeat` if the repaired draft still returns the same issue.
- `undefined-state-reference` is also a blocking product-quality issue: every `$var` used anywhere in the source must have a top-level literal declaration such as `$draft = ""` or `$currentScreen = "main"` before commit; send one repair attempt first, then fail cleanly with `Repeat` if the repaired draft still leaves it unresolved.
- Parser-invalid drafts should repair through the backend repair request path or fail cleanly; the builder should not apply browser-only source rewrites before commit.
- If a generation fails because the model keeps returning invalid OpenUI, both Preview and Definition must snap back to the last committed valid source as if the failed run never committed.
- Invalid source is never committed to Preview or builder history.
- That invalid-generation chat failure must end with: `An error occurred, a new version was not created. Please try rephrasing your request and run it again.`
- After that generation failure, an empty composer shows an enabled `Repeat` primary action that resubmits the last failed prompt.
- Typing any new prompt into the composer changes that primary action back to `Send` immediately.
- If a rejected cached/imported definition is visible and there is no committed preview source to fall back to, Preview shows `Preview is unavailable` with a light error treatment instead of the normal empty state.
- Frontend stream idle timeout or max-duration timeout must abort the in-flight request, surface a controlled failure message, and keep the last committed Preview visible.
- Automatic repair timeout or backend-reachability failures must keep the last committed Preview visible and surface repair-specific failure text instead of retrying the whole initial request as a silent fallback.
- Preview runtime issues reflect the current committed preview only and clear after a different valid committed source replaces the crashing one.
- Rejected imported source in Definition must not mix in stale runtime issues from the previous committed preview.
- Renderer/component exceptions inside Preview or `/elements` demos must stay contained to a local fallback UI instead of crashing the surrounding shell or route.
- Input-like components validate locally on change, blur, and submit-like primary button interactions.
- Required controls do not render red validation styling on first mount before any touch or submit-like interaction.
- Validation sets `aria-invalid` and error styling on the relevant control without rendering inline error text below it; helper text remains helper-only.
- Submit-like validation touch is scoped to the submitted screen/form subtree only and must not light up unrelated controls in other screens.
- Buttons are not globally auto-disabled by validation; any disabled state must still be expressed explicitly in generated OpenUI.
- Invalid or unsupported validation config must fail safely through parser/runtime issues and must not crash the app.
- Stale streamed chunks and stale non-streaming fallback responses are ignored and must never overwrite a newer generation request.
- Clicking `Cancel` mid-generation clears the in-progress request without appending a red chat error or committing partial source, and adds one neutral system confirmation message.
- Leaving `/chat` mid-generation clears the in-progress request without appending a red chat error or committing partial source.
- Starting a valid JSON import during an active generation also counts as an intentional abort: the in-flight request is cancelled, the import wins, and any late generation response is ignored.
- Undo, redo, and builder reset also stay available during generation; each must abort the active request first, apply the requested snapshot change, and ignore any late response from the cancelled run.
- Invalid import keeps the last committed Preview/runtime/domain state and only surfaces the rejected source in Definition with parse issues.
- Invalid import surfaces one clear failure status message instead of duplicate import errors.
- Reload restores the last committed Preview source together with the current live runtime state, persisted domain data, and undo/redo history.
- Invalid or legacy persisted `builderSession` / `domain` slice shapes are dropped back to defaults instead of being migrated from older contracts.
- The chat toolbar shows `Version: N / M` before the previous-version and next-version buttons, where `N` counts committed non-empty versions and may be `0` after undoing back to a blank canvas with history still available.
- A pristine blank builder with no committed version history shows `—` in the chat toolbar.
- Undo/redo keep a single rewind-status system chat message and update it in place rather than stacking multiple rewind notices.
- The rewind-status system chat message includes the same visible version number shown in the toolbar.
- `Reset` stays enabled whenever any committed version history exists, including the `0 / M` state after undoing back to a blank canvas.
- `Reset` is disabled only in the pristine empty builder state immediately after a fresh open or after `Reset`.
- `Reset` stays enabled whenever committed preview content exists, version history exists, or a rejected cached/imported definition is visible.
- Internal preview clicks do not call the LLM; only chat submissions should hit the generation endpoints, and the builder may additionally send `/api/llm/commit-telemetry` after validation or commit outcomes tied to real generation responses.
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
- `write_state` and `append_state` values must stay JSON-compatible, `append_item` values must be plain objects, `update_item_field` values must stay JSON-compatible, `merge_state` patches must stay plain objects, and `remove_state` requires an explicit non-negative integer `index` (whole number, no fractions).
- `append_item` preserves only non-empty string ids or finite numeric ids; blank or whitespace ids must be replaced with a generated stable `id`.
- For generated collection-row CRUD, do not mutate array elements through numeric persisted paths such as `app.items.0`; prefer id-based collection-item tools instead.
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
- Every `$var` used anywhere in the program must have a top-level literal declaration such as `$draft = ""`, `$accepted = false`, or `$currentScreen = "main"`.
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

- `RadioGroup` / `Select` `options` must be arrays of `{ label, value }` objects.
- If choice options come from collection rows such as `questions[i].options` or `item.options`, each row's `.options` field must already use `{ label, value }` objects; bare string or number arrays are a blocking product-quality issue.

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
$targetItemId = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
toggleItem = Mutation("toggle_item_field", {
  path: "app.items",
  idField: "id",
  id: $targetItemId,
  field: "completed"
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
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

- For `todo`, `task list`, `to-do`, or `список задач` requests, the minimum app must include `$draft`, `$targetItemId`, an input, `Query("read_state", { path: "app.items" }, [])`, `Mutation("append_item", { path: "app.items", value: ... })`, `Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })`, an add button action with `@Run(addItem)` + `@Run(items)` + `@Reset($draft)`, an action-mode checkbox row toggle with `Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)])`, `@Each(items, "item", ...)`, and `Repeater(rows, "No tasks yet.")`.
- Do not return a title-only, explanatory, or placeholder-only screen for a todo/task list request.
- If a simple todo request misses that minimum structure, repair before commit instead of committing the placeholder draft.
- For a simple todo app, do not add theme toggles, filters, due dates, compute tools, or extra fields unless the prompt explicitly asks for them.
- `Checkbox(...)` supports two modes: use a writable `$binding<boolean>` for local form state, or pass a display-only boolean plus `Action([...])` for explicit persisted row toggles.
- Do not combine checkbox action mode with a writable `$binding<boolean>` on the same control.
- Display-only `Checkbox(item.completed)` does not write back to persisted collections by itself.
- Inside `@Each(...)`, do not bind `Input`, `TextArea`, `Checkbox`, `RadioGroup`, or `Select` directly to `item.<field>` without an explicit `Action([...])`; those edits do not persist automatically.
- For canonical interactive todo rows, prefer an action-mode `Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))` instead of a read-only status `Text(...)`.
- `RadioGroup(...)` and `Select(...)` also support action mode: use a display-only string plus `Action([...])` when the chosen option should trigger a persisted update instead of local form binding.
- `RadioGroup(...)` and `Select(...)` must receive `options` as `{ label, value }` objects, not bare strings or numbers.
- Do not combine `RadioGroup` or `Select` action mode with a writable `$binding<string>` on the same control.
- In `RadioGroup` / `Select` action mode, the runtime writes the newly selected option to reserved `$lastChoice` before the action runs.
- Use `$lastChoice` only inside `RadioGroup` / `Select` action-mode flows or the top-level `Mutation(...)` / `Query(...)` statements those actions run. Do not render it directly in UI text, disabled expressions, or unrelated statements.
- For persisted collection row actions, define top-level `Mutation(...)` statements such as `append_item`, `toggle_item_field`, `update_item_field`, or `remove_item`, then relay item context through local state inside the row `Action(...)`.
- The `/elements` `Checkbox`, `RadioGroup`, and `Select` demos should all showcase this repeater-row action-mode pattern against persisted collections rather than standalone saved scalars.

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

- `@Filter(...)` supports `==`, `!=`, `>`, `<`, `>=`, `<=`, and `contains`.
- Use `contains` for substring search such as `@Filter(items, "title", "contains", $query)`, not invented `includes`.
- Use `>`, `<`, `>=`, and `<=` for numeric values or numeric strings such as `@Filter(items, "score", ">=", 80)`.

Action-mode choice recipe:

```txt
$targetPreferenceId = ""
preferences = Query("read_state", { path: "ui.preferences" }, [])
setPreferenceFilter = Mutation("update_item_field", {
  path: "ui.preferences",
  idField: "id",
  id: $targetPreferenceId,
  field: "filter",
  value: $lastChoice
})
rows = @Each(preferences, "item", Group(null, "vertical", [
  Select("filter-" + item.id, "Show", item.filter, filterOptions, null, [], Action([@Set($targetPreferenceId, item.id), @Run(setPreferenceFilter), @Run(preferences)])),
  Text("Persisted filter: " + item.filter, "body", "start")
], "inline"))
Repeater(rows, "No saved preferences.")
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
- `RadioGroup(..., item.plan, ..., [], Action([@Set($targetId, item.id), @Run(updateItem), @Run(items)]))` for persisted collection-row choices that must write through `$lastChoice`
- `Select(..., item.filter, ..., [], Action([@Set($targetId, item.id), @Run(updateItem), @Run(items)]))` for persisted collection-row filters that must write through `$lastChoice`
- declarative validation arrays only, using supported rule names and type-appropriate rules
- `Text(...)` only with `appearance.contrastColor`; never `Text(..., { mainColor: ... })`
- for any `Button(..., variant, ..., appearance)` use `appearance.mainColor` as the button background and `appearance.contrastColor` as the button text
- `Button(..., "default", ...)` when you want the filled fallback button style without appearance
- `Button(..., "secondary", ...)` when you want the outlined fallback button style without appearance
- conditional `appearance` such as `{ mainColor: "#DC2626", contrastColor: "#FFFFFF" }` for an active red theme toggle, with the inactive toggle falling back to `appTheme`
- do not manually pass the same `appearance` to every `Input`, `Select`, `RadioGroup`, or other control when the goal is one shared app theme
- local control `appearance` only when a specific control must override the inherited theme
- conditional `appearance` for active buttons or selected theme toggles
- existing variants first when they already express the requested visual treatment
- parent `AppShell`, `Screen`, `Group`, and `Repeater` appearance values recolor nested controls automatically
- avoid over-nesting block groups
- `Repeater(...)` only for dynamic or generated collections, with rows built via `@Each(...)`
- `@Filter(...)` and `@Count(...)` built-ins for derived filtered collections and counts, with `@Filter(...)` operators `==`, `!=`, `>`, `<`, `>=`, `<=`, and `contains`
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
