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
- frontend submit-time preflight must block requests whose `prompt`, `currentSource`, `invalidDraft`, or serialized derived-context payload already exceeds the matching `GET /api/config` limit, show one clear builder error, and avoid sending that oversized request; the backend `413` limit remains the security boundary
- backend model output above the configured byte limit must fail with a controlled `upstream_error`
- malformed JSON envelopes, missing required `summary` / `changeSummary` / `source` / `appMemory`, empty `source`, invalid `summary` / `changeSummary` / `appMemory`, or extra envelope fields must fail as controlled errors instead of reaching the OpenUI parser
- `GET /api/config` must expose frontend-safe generation temperatures, request limits, the stream timeout policy used by the builder UI, and `repair.maxRepairAttempts`
- `POST /api/llm/generate` and `POST /api/llm/generate/stream` accept the latest user `prompt`, the current committed source, compact previous `appMemory`, derived `previousUserMessages`, derived `previousChangeSummaries`, optional `historySummary`, and repair-only `invalidDraft` plus structured validation issues. The visible chat transcript remains persisted for UX but is not sent wholesale as `chatHistory`. The frontend may send more derived previous context than the model prompt will use; backend request preparation owns compaction and trims model-visible `previousUserMessages` to at most 5 earlier user prompts and 4096 total characters, `previousChangeSummaries` to at most 5 committed change summaries and 1024 total characters, and `historySummary` to at most 512 characters. Long chat context is compacted only for older dropped chat/change records. The committed source is never summarized. The internal summary model call must receive only dropped older `previousUserMessages`, dropped older `previousChangeSummaries`, and an optional prior `historySummary`; it must not receive `currentSource`, `appMemory`, validation issues, system prompt text, or runtime preview data. `appMemory` is `{ version: 1, appSummary, userPreferences, avoid }`, capped to 4096 serialized characters, and is model context only, not runtime or exported preview state. `prompt` is capped by `GET /api/config` `limits.promptMaxChars`; `currentSource` and `invalidDraft` are capped by `limits.sourceMaxChars`; the full serialized request is still capped by `limits.requestMaxBytes` after backend compaction. Context budgeting applies only to optional context; the committed source is protected because it is the authoritative app definition. Repair validation issues may include optional `severity` to preserve blocking/fatal/warning priority across the frontend/backend boundary. Issue-specific repair context must be structured, such as `undefined-state-reference` `context.refName` / `context.exampleInitializer`, `quality-stale-persisted-query` `context.statementId` / `context.suggestedQueryRefs`, and `quality-options-shape` `context.groupId` / `context.invalidValues`. The backend assembles model-visible initial and repair prompt text from this derived context package.
- generation rate limiting and commit telemetry matching must ignore client-supplied `x-forwarded-for` and `x-real-ip` headers
- `POST /api/llm/generate` and `POST /api/llm/generate/stream` share one process-local generation rate-limit bucket. This is intentional for the no-auth demo scope and is meant to cap demo traffic, not provide per-user isolation. A non-stream fallback after a pre-activity stream transport/timeout failure must reuse the same `x-kitto-request-id`, send `x-kitto-stream-fallback: 1`, and consume only a recorded one-use fallback exemption; early upstream API/model errors must not grant fallback exemptions. An automatic repair must send `x-kitto-automatic-repair: 1`, `x-kitto-repair-for`, and `x-kitto-repair-attempt`, then consume only the recorded one-use repair exemption for that parent request and attempt. A manual `Repeat` after failure is different: it resubmits the saved prompt as a fresh `mode: initial` generation with a new request id, must not send automatic-repair headers, must count as a normal generation request, and only earns a new repair exemption chain after that repeated generation completes.
- the model envelope schema is `{ summary, changeSummary, source, appMemory }`, while the backend `POST /api/llm/generate` response and streaming `done` event payload are `{ source, model, temperature, summary, changeSummary, appMemory, historySummary?, summaryWarning?, summaryExcludeFromLlmContext?, qualityIssues, compaction? }`
- `POST /api/llm/commit-telemetry` must accept fire-and-forget client commit outcomes only for recently completed generation request ids sent in `x-kitto-request-id`, validate that the JSON body request id matches that header including optional `qualityWarnings`, reject unmatched or overused request ids before accepting arbitrary telemetry bodies, and stay separate from import-only local flows
- Builder revisions must persist committed source together with the matching compact LLM `appMemory`, `historySummary`, `summary`, and `changeSummary`; undo/redo/reload must restore the matching source, memory, and history summary.

## Prompt docs page

- Open `/elements`, switch to the `Prompts` tab, and verify the page renders the backend config, system prompt, intent context, user prompt template, tool specs, repair prompt, and output envelope schema sections.
- Confirm `Output envelope schema` documents the model envelope only (`summary`, `changeSummary`, `source`, and `appMemory`) and does not describe the outer backend response payload fields such as `model` or `compaction`.
- Confirm the prompts tab shows the same contents-style table of contents and per-section return-to-top button pattern used by `Elements` / `Actions`.
- Confirm the system-prompt block shows a visible `systemPromptHash`.
- Confirm the system-prompt block is layered: the base view shows core syntax/rules plus base tool specs, while production requests build intent-aware system prompts with cache keys such as `kitto:openui:t:<componentSpecHash>` or `kitto:openui:th:<componentSpecHash>`.
- Confirm the intent-context block shows intent tabs for `Base`, `Todo`, `Theme`, `Control showcase`, `Filter`, `Validation`, `Compute`, `Random`, `Delete`, and `Multi-screen`; each tab changes the displayed `intentVector`, sample request, and `<intent_context>` text using the single `/api/prompts/info` response.
- Confirm the `Repair prompt` section explicitly mentions the repair temperature `0.2`.
- Confirm the user prompt template documents the initial input shape: earlier transcript turns are not sent as separate role-based messages; the final user turn contains `<intent_context>`, derived `<previous_user_messages>` / `<previous_change_summaries>` context when present, and the latest request/current source blocks.
- Confirm the user prompt template documents the role-based repair input shape: system repair instruction, user `<original_user_request>` / optional `<conversation_context>` / protected `<current_source>`, assistant `<model_draft_that_failed>`, and final user `<validation_issues>` / `<hints>` with the corrected-source instruction.
- Confirm the `<request_intent>` block appears inside `<intent_context>` as one readable sentence beginning `This request appears to be:` and summarizes operation, screen flow, scope, and detected feature hints.
- Confirm intent-specific rules live in the system intent layer; `<intent_context>` carries request intent, relevant fragment/full examples, and stable examples without duplicating those rules.
- Confirm the final user turn contains `<latest_user_request>` plus full `<current_source>` for normal follow-up generation while the committed source stays at or below the 50,000 character emergency cap. It must not replace the authoritative source with inventory, currentSourceItems, summaries, or `appMemory`.
- Confirm requests may include optional `previousSource`; when present, the final user turn may include `<previous_changes>` with a short source-delta summary after protected request/source blocks.
- Confirm source-inventory/currentSourceItems diagnostics are optional hints only when present. Normal follow-up generation must keep protected `<current_source>` as the source of truth and must not switch to inventory-only or summary-only context.
- Confirm the user prompt template says the structured `summary` must describe the visible app/change in one complete user-facing sentence under 200 characters, includes bad/good summary examples, and rejects generic phrasing such as `Updated the app`.
- Confirm the user prompt template includes a follow-up output requirement for modify requests that the summary must describe the specific change made to the existing app.
- Confirm the repair-prompt block carries the same structured-envelope guidance and always instructs the model to return the corrected program in `source`.
- Confirm repair examples use the failed draft plus issues/hints and keep validation issues present; committed source appears as protected `<current_source>` context instead of current-source inventory.
- Confirm the repair-prompt block renders backend-owned parser-only, quality-only, and mixed repair examples from the same builder used in production.
- Confirm the system prompt does not contain legacy generic OpenUI examples such as `Stack(...)`, `Col(...)`, `FormControl(...)`, `SelectItem(...)`, `TextContent(...)`, `SomeComp(...)`, or `SomeChart(...)`.
- Confirm the prompts tab stays read-only and does not show edit or copy controls.

## Prompt baseline

- Stable structured system prompt baselines are exposed by `/api/prompts/info` through `systemPromptHash` and `systemPromptCharCount`.
- After prompt-contract changes, compare the current values from `/api/prompts/info` against the expected review baseline for that change rather than relying on a hardcoded value in this checklist.

## Runtime invariants

- Preview renders committed source only.
- Builder undo/redo navigates committed revisions. Each revision carries source plus compact LLM app memory; live preview runtime/domain state remains separate from model context memory and is not part of exported runtime interactions.
- After the initial health check resolves, the builder shell must stay usable even if `GET /api/config` is still loading or has failed.
- While `GET /api/config` is unresolved or failed, chat send stays disabled with an explicit composer hint, while import, undo/redo history, committed Preview, and `/elements` remain available.
- The header does not show a runtime-config status badge. While `GET /api/config` is loading, the composer hint explains that chat send is waiting; when config or health checks fail, Chat shows one red backend status message at the end: `Backend services are unavailable. Chat send is disabled until /api/health and /api/config recover.`
- The `Context` tab shows a char-based table of prompt context sections with `Prio`, `Section`, `Chars`, `Limits`, `Used`, and `Budget` columns; `Limits` uses backend-provided values from prompt diagnostics/generation metadata and shows `SOFT ...` and/or `(HARD ...)` when configured, committed `currentSource` is protected, and each row expands to show the backend prompt payload for that section.
- While generation is in progress, Preview keeps that committed source (or empty state) visible behind a semi-transparent blocking overlay with a spinner and contextual status label: `Generating...` for the first prompt, `Updating...` for follow-up edits, or a backend status such as `Compacting older chat context...` before model chunks arrive.
- Every generation ends in exactly one terminal state: committed, failed, or cancelled. The builder must never remain stuck in `Generating...` or `Updating...` indefinitely.
- Structural nesting is hard-invalid: keep exactly one `root = AppShell([...])` statement, never nest `AppShell(...)`, never put `Screen(...)` inside another `Screen(...)`, and never put `Repeater(...)` inside another `Repeater(...)`.
- `Group(...)` inside `Group(...)` remains valid and should not be flagged on its own.
- Definition may show streamed draft text while generation is still in progress, but it must render only the parsed partial OpenUI `source`, not the raw JSON envelope.
- While a generation is still in progress, chat should show a single pending assistant summary. Before model summary chunks arrive, backend `status` events may update that pending blue message with processing/compaction status; as soon as streamed `summary` becomes available, the same message updates to the summary. The pending summary uses a shimmer loading treatment instead of adding a textual status prefix.
- Streaming `status` events are informational backend processing updates, `chunk` events reflect the in-progress model envelope, and only the final `done` event carries the backend response payload with `model`, prompt-aware `qualityIssues`, and optional `historySummary` / `summaryWarning` / `summaryExcludeFromLlmContext` / `compaction`.
- When the backend compacts oversized chat history for an initial generation request, it should prefer keeping the earliest retained user request for the current app context plus the newest retained context instead of collapsing to a newest-only tail when both cannot fit.
- After a successful commit, that summary should remain in chat as a normal assistant message and stay eligible for future LLM context unless it is explicitly marked otherwise.
- Committed assistant summaries that stay in LLM context should describe concrete user-visible changes; generic status-only summaries such as `Updated the app` or `Made the requested changes` should not survive as context.
- Valid but over-complex committed drafts may surface non-blocking Definition warnings for unrequested complexity such as extra screens, themes, filters, validation rules, compute tools, or excessive block groups, based on backend prompt-aware quality analysis merged with local source validation.
- Todo/task-list requests that commit without the minimum todo controls must surface the non-blocking Definition warning `Todo request did not generate required todo controls.` when backend prompt-aware quality validation classifies it as a warning instead of a blocker.
- Those quality warnings must not trigger auto-repair, reject the draft, or block commit/history updates.
- Fatal or blocking product-quality issues must trigger automatic repair attempts up to `repair.maxRepairAttempts` before commit (default: 2 attempts) even when the draft is syntactically valid.
- When an automatic repair request is in flight, chat should reuse the pending assistant summary card with shimmer and show `Something went wrong and your request was sent again`; if a second repair starts, the same card should update to `Something went wrong and your request was sent again (2)`.
- Each automatic repair request should append model-visible context that the previous draft was rejected, with a message like `Previous draft rejected due to: <codes>`, and the backend repair prompt should include that context before the corrected-source instruction.
- The backend model input for automatic repair must be role-based, with recent filtered conversation context in a bounded `<conversation_context>` block when available, the rejected draft in an assistant message, and the issue/hint correction request in the final user message.
- If all repair attempts fail, remove the pending assistant summary card and show one red error card with `Something went wrong and your request couldn’t be completed. The previous valid app was kept. Please retry.` plus an expandable dotted-underlined `Details` control containing the technical error text and any available code/status/message metadata.
- `control-action-and-binding` for `Checkbox`, `RadioGroup`, or `Select` is a blocking product-quality issue: send repair attempts first, then fail cleanly with `Repeat` if the repaired draft still returns the same issue.
- `reserved-last-choice-outside-action-mode` is also a blocking product-quality issue: send repair attempts first, then fail cleanly with `Repeat` if the repaired draft still returns the same issue.
- `undefined-state-reference` is also a blocking product-quality issue: every `$var` used anywhere in the source must have a top-level literal declaration such as `$draft = ""` or `$currentScreen = "main"` before commit; send repair attempts first, then fail cleanly with `Repeat` if the repaired draft still leaves it unresolved.
- `quality-missing-screen-flow` is also a blocking product-quality issue for step-by-step flow requests: conditional flow sections need local state based `isActive` gates and `@Set(...)` navigation before commit, while always-visible helper sections may omit `isActive`.
- `all-conditional-screens-hidden-initially` is a blocking product-quality issue when every meaningful `Screen(...)` section is conditional and none is obviously visible from the initial state. Multi-section apps with omitted `isActive` must not warn or repair.
- Source validation should reject/repair duplicate literal screen, component, and button ids; unknown `@Run(...)` refs; unsafe literal `Link(...)` / `@OpenUrl(...)` URLs; unsafe literal `Mutation("open_url", { url: ... })` drafts; and navigation actions that target missing `Screen` ids. URL validation issues must include the concrete rejected URL. `orphan-screen` remains a soft warning and must not block commit.
- `quality-missing-control-showcase-components` is also a blocking product-quality issue for every-control/component-showcase requests: the visible app must include `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, and `Link`.
- Parser-invalid drafts should repair through the backend repair request path or fail cleanly; the builder should not apply browser-only source rewrites before commit.
- If a generation fails because the model keeps returning invalid OpenUI, both Preview and Definition must snap back to the last committed valid source as if the failed run never committed.
- Invalid source is never committed to Preview or builder history.
- That invalid-generation chat failure must end with: `An error occurred, a new version was not created. Please try rephrasing your request and run it again.`
- After that generation failure, an empty composer shows an enabled `Repeat` primary action that resubmits the last failed prompt.
- `Repeat` must use the normal initial-generation path instead of the automatic repair continuation path, so it starts with its own repair attempt budget and does not reuse a repair rate-limit credit from the prior failed run.
- Typing any new prompt into the composer changes that primary action back to `Send` immediately.
- If a rejected generation draft is visible and there is no committed preview source to fall back to, Preview shows `Preview is unavailable` with a light error treatment instead of the normal empty state. Imports are different: every import attempt resets the builder first, so invalid imports leave Preview on the reset blank state.
- Frontend stream idle timeout or max-duration timeout must abort the in-flight request, surface a controlled failure message, and keep the last committed Preview visible.
- Automatic repair timeout or backend-reachability failures must keep the last committed Preview visible and surface repair-specific failure text instead of retrying the whole initial request as a silent fallback.
- Preview runtime issues reflect the current committed preview only and clear after a different valid committed source replaces the crashing one.
- Rejected imported source in Definition must not mix in stale runtime issues from the previous committed preview.
- Renderer/component exceptions inside Preview or `/elements` demos must stay contained to a local fallback UI instead of crashing the surrounding shell or route.
- Input-like components validate locally on change, blur, and submit-like primary button interactions.
- Required controls do not render red validation styling on first mount before any touch or submit-like interaction.
- Validation sets `aria-invalid` and error styling on the relevant control without rendering inline error text below it; helper text remains helper-only.
- Submit-like validation touch is scoped to the submitted screen/form subtree only and must not light up unrelated controls in other screens.
- Open `Select` dropdowns should render above adjacent `Group(...)` sections and remain fully visible, not clipped or hidden behind the next block.
- Buttons are not globally auto-disabled by validation; any disabled state must still be expressed explicitly in generated OpenUI.
- Invalid or unsupported validation config must fail safely through parser/runtime issues and must not crash the app.
- Stale streamed chunks and stale non-streaming fallback responses are ignored and must never overwrite a newer generation request.
- Clicking `Cancel` mid-generation clears the in-progress request without appending a red chat error or committing partial source, and adds one neutral system confirmation message.
- The cancelled user prompt remains visible in chat but is excluded from the next initial-generation `previousUserMessages` payload sent to the backend.
- Leaving `/chat` mid-generation clears the in-progress request without appending a red chat error or committing partial source.
- Starting a valid JSON import during an active generation also counts as an intentional abort: the in-flight request is cancelled, the import wins, and any late generation response is ignored.
- Successful JSON import, demo load, and builder reset start fresh builder chat context for the new app or blank canvas; stale pre-change user requests must not be sent on the next generation.
- Undo, redo, and builder reset in the chat toolbar are disabled during generation; use `Cancel` first before changing builder history or clearing the builder.
- Invalid import resets the builder first, so the previous committed Preview/runtime/domain state is cleared before the failure is surfaced. Parser-invalid OpenUI imports may still show the rejected source in Definition with parse issues, while Preview falls back to the reset blank state.
- Invalid import surfaces one clear failure status message instead of duplicate import errors.
- Reload restores the last committed Preview source together with the current live runtime state, persisted domain data, and undo/redo history.
- New chat-generated commits intentionally reset local runtime state instead of migrating screen/form variables across source versions.
- After commit, valid import, undo, or redo, a stale `domain.navigation.currentScreenId` that no longer matches any committed `Screen(...)` id is repaired to an existing fallback screen id; this must not impose a single-active-screen model, and always-visible `Screen(...)` sections remain visible.
- Invalid or legacy persisted `builderSession` / `domain` slice shapes are dropped back to defaults instead of being migrated from older contracts.
- The chat toolbar shows `Version: N / M` before the previous-version and next-version buttons, where `N` counts committed non-empty versions and may be `0` after undoing back to a blank canvas with history still available.
- A pristine blank builder with no committed version history shows `—` in the chat toolbar.
- Undo/redo keep a single rewind-status system chat message and update it in place rather than stacking multiple rewind notices.
- The rewind-status system chat message includes the same visible version number shown in the toolbar.
- `Reset` stays enabled whenever any committed version history exists, including the `0 / M` state after undoing back to a blank canvas, unless a generation is active.
- `Reset` is disabled in the pristine empty builder state immediately after a fresh open or after `Reset`, and while a generation is active.
- `Reset` stays enabled whenever committed preview content exists, version history exists, or a rejected cached/imported definition is visible, unless a generation is active.
- Internal preview clicks do not call the LLM; only chat submissions should hit the generation endpoints, and the builder may additionally send `/api/llm/commit-telemetry` after validation or commit outcomes tied to real generation responses.
- Standalone HTML export always uses the committed source and the committed snapshot baseline runtime/domain state, not the builder’s current live clicked state.
- Standalone HTML files run without the Kitto shell, backend, OpenAI config, or `/api/*` requests.
- Standalone HTML files persist their own runtime/domain state in localStorage and can reset back to the embedded baseline state.
- Each standalone HTML export gets its own localStorage namespace, even when two downloads use the same committed source.
- Root-relative app paths such as `/chat`, hash/self links such as `#details`, `mailto:`, and `tel:` must be treated as invalid/inert in every runtime.
- `toolProvider` is only used by `Query(...)` and `Mutation(...)`.
- Allowed tool names are `read_state`, `compute_value`, `write_state`, `merge_state`, `append_state`, `append_item`, `toggle_item_field`, `update_item_field`, `remove_item`, `remove_state`, and `write_computed_state`.
- Persisted tool paths must be non-empty dot-paths no deeper than 10 segments.
- Persisted path segments may use only letters, numbers, `_`, or `-`, and must reject `__proto__`, `prototype`, and `constructor`.
- Numeric path segments are valid only when they address array indexes.
- `write_state` and `append_state` values must stay JSON-compatible, `append_item` values must be plain objects, `update_item_field` values must stay JSON-compatible, `merge_state` patches must stay plain objects, and `remove_state` requires an explicit non-negative integer `index` (whole number, no fractions).
- `append_item` preserves only unique non-empty string ids or finite numeric ids; blank, whitespace, or duplicate ids must be replaced with a generated stable `id`.
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
- `Link(...)` and `@OpenUrl(...)` must share the same URL allowlist: full absolute `https://...` and `http://...` URLs only. `mailto:`, `tel:`, app-relative `/...`, hash links `#...`, and protocol-relative `//...` URLs must be invalid at source validation and inert at runtime.
- `Link(...)` must render inert text instead of an anchor when the URL is empty, malformed, or uses blocked schemes such as `javascript:`, `data:`, or `blob:`.
- `@OpenUrl(...)` must ignore empty, malformed, or blocked URLs without throwing.
- Source validation must rely on the OpenUI parser AST/component/built-in allowlists for executable surface. Regex checks are only defence-in-depth for executable-looking syntax outside string literals; URL protocol decisions belong only to `safeUrl.ts`.
- `Screen(...)` is a major visible section, not necessarily a route. Multiple `Screen(...)` components may be visible at once.
- Omit `isActive` for always-visible `Screen(...)` sections. Use local state such as `$currentScreen` with `@Set(...)` only when a section is conditionally visible.
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
For simple counters, use local state such as `$count = 0` and buttons with `@Set($count, $count + 1)`. Use persisted tools for counters only when the user explicitly asks for reload/export persistence.
```

Layout simplicity:

- Use `Screen(...)` for top-level app sections.
- `Screen(...)` is a major visible section, not necessarily a route.
- Multiple `Screen(...)` components may be visible at once.
- Omit `isActive` for always-visible sections; use `isActive` only when a section should conditionally render.
- For step-by-step flows, make sure the initial render has at least one visible `Screen(...)`.
- Drafts where all conditional screens are hidden initially should repair or fail before commit; the no-visible-content Preview message is reserved for non-generation/import/runtime edge cases that still produce no visible content.
- Prefer one `Screen(...)` for simple apps unless the request naturally needs multiple major sections.
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
- Generated positional calls may use `null` or `[]` when skipping `validation` before `action` or `appearance`; both placeholders should behave as no validation rules rather than crashing the runtime.

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

Screen visibility:

```txt
$currentStep = "intro"
root = AppShell([
  Screen("intro", "Intro", [
    Text("Welcome", "title", "start"),
    Button("go-form", "Start", "default", Action([@Set($currentStep, "form")]), false)
  ], $currentStep == "intro"),
  Screen("form", "Form", [
    Text("Fill the form", "body", "start")
  ], $currentStep == "form"),
  Screen("help", "Help", [
    Text("This help section is always visible", "body", "start")
  ])
])
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

Control-showcase guardrails:

- For `every control`, `all controls`, or component-showcase requests, include at least one visible `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, and `Link`.
- A missing required showcase control is a blocking quality issue and should repair before commit.
- `RadioGroup(...)` and `Select(...)` also support action mode: use a display-only string plus `Action([...])` when the chosen option should trigger a persisted update instead of local form binding.
- `RadioGroup(...)` and `Select(...)` must receive `options` as `{ label, value }` objects, not bare strings or numbers.
- `RadioGroup(...)` and `Select(...)` must use exactly one mode: binding mode passes a writable `$state` value and no action; action mode passes a display string value plus `Action([...])`, and only action mode may use `$lastChoice`.
- For simple local UI preferences such as a theme selector, prefer binding mode like `$theme = "dark"` plus `Select("theme", "Theme", $theme, themeOptions, null)` instead of action mode.
- Do not combine `RadioGroup` or `Select` action mode with a writable `$binding<string>` on the same control.
- When an action-mode `RadioGroup(...)` or `Select(...)` has no validation rules, pass `null` for helper and either `null` or `[]` for validation before `Action([...])`.
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
- remember `Query("read_state", ...)` returns the raw persisted value or `null`; only `compute_value` and `write_computed_state` return `{ value }`
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
- `RadioGroup(..., item.plan, ..., null, null, Action([@Set($targetId, item.id), @Run(updateItem), @Run(items)]))` for persisted collection-row choices that must write through `$lastChoice`
- `Select(..., item.filter, ..., null, null, Action([@Set($targetId, item.id), @Run(updateItem), @Run(items)]))` for persisted collection-row filters that must write through `$lastChoice`
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
- invalid import should reset the builder first, then show one clear failure state; parser-invalid OpenUI imports may show Definition validation issues, but stale preview, chat, undo/redo history, runtime state, and persisted data should be cleared
- undo/redo when generation is not active
- reset when generation is not active

## Acceptance criteria

- QA docs exist in `docs/qa/`.
- `README.md` links to the QA docs.
- The docs reflect the current API, runtime, and prompt/component contract.
