# Kitto OpenUI Agent Smoke Test

## Purpose

Fast browser/MCP smoke pass for Kitto as a chat-based frontend app builder.

This is not a full regression suite. Full edge cases live in `docs/qa/openui-manual-checklist.md`.

## Setup

1. Start the app:

   ```bash
   npm run dev
   ```

2. Open:

   `http://localhost:5555/chat`

3. Wait until the backend model status in the header is `connected`.
4. Confirm no runtime-config badge appears in the header. Chat send must stay disabled while `/api/config` is still loading, then unlock once runtime config finishes loading.
5. Open DevTools:
   - `Console` for runtime/parser errors.
   - `Network` filtered to `/api/config`, `/api/prompts/info`, and `/api/llm`.
6. While a generation is streaming, Chat should surface one human-readable pending assistant summary with a loading shimmer, and Definition should show only parsed OpenUI source text rather than the raw structured JSON envelope.
7. In streaming responses, confirm the final `done` payload can include `source`, `model`, `summary`, `qualityIssues`, and optional `summaryExcludeFromLlmContext` / `compaction`.
8. If the stream fails before any `chunk` or final `done` event because of a transport/timeout error and the builder retries through `POST /api/llm/generate`, confirm that fallback reuses the same `x-kitto-request-id`, sends `x-kitto-stream-fallback: 1`, and does not consume a second generation rate-limit slot. Early upstream API/model errors should not grant that exemption.
9. If automatic repair runs, confirm the repair request sends `x-kitto-automatic-repair: 1`, `x-kitto-repair-for: <parent request id>`, and `x-kitto-repair-attempt: <attempt number>`; it should consume only a recorded one-use repair exemption from the completed parent generation, not an open-ended rate-limit bypass.
10. If a failed generation leaves `Repeat` enabled, confirm clicking `Repeat` sends a fresh initial generation with a new `x-kitto-request-id`, no `x-kitto-automatic-repair` headers, and no repair exemption consumption from the failed run.
11. After a completed generation, follow-up `/api/llm/commit-telemetry` requests should send the same completed generation id in `x-kitto-request-id` and in the JSON body; telemetry without a completed generation id should be rejected instead of parsed as an open-ended request body.
12. If you intentionally trigger chat-history compaction during an iterative edit flow, confirm the next request still keeps the original first user intent for the current app context together with the newest surviving context instead of collapsing to a newest-only tail. After reset, valid import, or demo load, older pre-change user requests should not be sent as LLM chat history.
13. For trivial validation problems such as misordered `Group(...)` args or legacy appearance keys, confirm the draft stays invalid until the normal repair path runs or the request fails cleanly; no browser-only auto-fix patching should happen.
14. `/api/config` `limits` should include `promptMaxChars`, `chatMessageMaxChars`, `sourceMaxChars`, `chatHistoryMaxItems`, and `requestMaxBytes`; submit-time preflight should block any one field or full serialized payload that exceeds those limits.

## MCP automation notes

- Type prompts into the chat textarea with real typing after focus.
- Do not use DOM-only fill.
- For import, if the OS picker is unavailable, it is acceptable to use the hidden `input[type="file"]` with a generated `File`.
- When validating local interactions, distinguish chat-driven generation requests from follow-up telemetry. Local preview clicks must not trigger fresh `/api/llm/generate*` requests.

## Scenario 0 — Runtime config and prompt docs page

### Steps

1. Open `/elements`.
2. Switch to the `Prompts` tab.
3. Return to `/chat`.

### Expected

- The `Prompts` tab renders:
  - `Backend config`;
  - `System prompt`;
  - `Intent context`;
  - `User prompt template`;
  - `Tool specs`;
  - `Repair prompt`;
  - `Output envelope schema`.
- The system-prompt block shows a visible `systemPromptHash`.
- The system-prompt block is stable: it shows the `Base` system prompt, `intentVector: base`, and a single stable `promptCacheKey` keyed as `kitto:openui:base:<componentSpecHash>` without a system prompt hash suffix.
- The `Intent context` block includes intent tabs for `Base`, `Todo`, `Theme`, `Control showcase`, `Filter`, `Validation`, `Compute`, `Random`, and `Multi-screen`; switching tabs changes the shown `intentVector`, sample request, and `<intent_context>` text without issuing another prompt-info request.
- `/api/config` exposes runtime generation temperatures for builder startup: initial `0.4` and repair `0.2`.
- The `Repair prompt` section explicitly mentions repair temperature `0.2`.
- The `System prompt` filtering guidance lists supported `@Filter(...)` operators `==`, `!=`, `>`, `<`, `>=`, `<=`, and `contains`, and uses `contains` rather than invented `includes`.
- The `System prompt` text does not include legacy generic OpenUI examples such as `Stack(...)`, `Col(...)`, `FormControl(...)`, `SelectItem(...)`, `TextContent(...)`, `SomeComp(...)`, or `SomeChart(...)`.
- The user prompt template shows the role-based initial input shape: earlier user/assistant turns are sent as separate role-based messages, assistant summaries stay wrapped in `<assistant_summary>`, then a separate `<intent_context>` user message carries `<request_intent>`, intent-specific rules, and relevant patterns/examples before the final user turn.
- The user prompt template also shows the role-based repair input shape: system repair instruction, user `<original_user_request>` / optional `<conversation_context>` / `<current_source_inventory>`, assistant `<model_draft_that_failed>`, and final user `<validation_issues>` / `<hints>` with the corrected-source instruction.
- The `<request_intent>` block inside `<intent_context>` lists todo/controlShowcase/filtering/validation/compute/random/theme/multiScreen booleans plus `operation` (`create`, `modify`, `repair`, or `unknown`) and `minimality` (`simple` or `normal`).
- The final user turn contains optional `<current_source_inventory>`, `<latest_user_request>`, and `<current_source>` blocks.
- The optional `<current_source_inventory>` block appears before `<current_source>` when the committed source can be parsed and summarizes existing statements, screen ids, Query/Mutation tools, runtime state names, and persisted domain paths.
- The user prompt template explicitly says the structured `summary` must describe the visible app/change in one complete user-facing sentence under 160 characters, includes bad/good summary examples, and must not use generic phrases like `Updated the app`.
- The user prompt template adds a follow-up output requirement for modify requests that the summary must describe the specific change made to the existing app.
- The `Repair prompt` section carries the same structured-summary quality guidance and always instructs the model to return the corrected program in `source`.
- `Output envelope schema` documents the model envelope only: `summary` and `source`.
- The prompts page is read-only and does not show edit or copy controls.
- `/chat` does not show a runtime-config badge in the header.
- Chat send stays disabled while `/api/config` is unresolved, with a clear composer hint.
- If `/api/config` fails, Chat shows one red system message: `Runtime config is unavailable. Chat send is disabled until /api/config can be loaded.`
- After config load completes successfully, chat send becomes available without a page reload.

## Scenario 1 — Simple todo stays simple

### Prompt

```txt
Create a todo list.
```

### Expected

- The app commits successfully.
- While the request is streaming, chat shows one human-readable pending assistant summary before commit. The pending summary uses a shimmer loading treatment instead of adding a textual status prefix.
- The app has a simple todo UI:
  - task input;
  - add button;
  - task list rendered from a dynamic collection;
  - interactive completion toggle.
- User can add a task.
- User can toggle a task complete/incomplete.
- Definition does not show `Todo request did not generate required todo controls.`.
- Todo rows use persisted list actions rather than static placeholder rows.
- Local todo interactions do not trigger fresh `/api/llm/generate*` requests.
- No parser/runtime errors appear.
- The app does not add unrelated features such as:
  - theme toggle;
  - due dates;
  - filtering;
  - compute tools;
  - extra screens;
  unless the model has a strong product reason and the UI still works.

## Scenario 2 — Multi-screen local flow

### Prompt

```txt
Create a quiz app with intro, three questions on separate screens, and result screen. Use radio buttons, a Next button, and a Restart button.
```

### Expected

- Intro screen appears after commit.
- The app must not go blank; if the generated source somehow resolves every `Screen(...)` inactive, the first screen should still render as a runtime fallback.
- Start/Begin works.
- Radio selection works.
- If quiz choices are generated from collection data, committed `RadioGroup(...)` / `Select(...)` options use `{ label, value }` objects rather than bare string arrays; invalid bare-string drafts should repair or stay blocked instead of committing.
- Next works.
- Restart works.
- Internal clicks do not trigger fresh `/api/llm/generate*` requests.
- No parser/runtime errors.

## Scenario 3 — Follow-up edit preserves existing app

### Prompt

```txt
Add a required checkbox confirmation before the result screen.
```

### Expected

- Existing quiz flow remains usable.
- The follow-up may restart Preview from the regenerated app's initial local runtime state; do not require preserving the pre-edit screen.
- Checkbox appears before result/submit.
- Checkbox affects the flow or validation.
- The pre-commit chat summary stays readable under its shimmer loading treatment, and the committed assistant summary remains in chat after success without the loading treatment.
- The committed assistant summary says what changed in concrete user terms rather than generic status text such as `Updated the app`.
- Final committed source is valid.
- If repair runs, final repaired app still works.
- No broken actions or unresolved refs remain.

## Scenario 4 — Theme / appearance / active theme button

### Prompt

```txt
Build an app with every control you know. Add a separate top group with two buttons for light and dark themes. The active theme must be shown as a RED button with white text.
```

### Expected

- There are light and dark theme buttons.
- The first committed draft already shows the active theme button as red background with white text.
- Inactive theme button is not red.
- Clicking theme buttons changes theme locally.
- Theme affects visible app colors, not only text labels.
- The theme block also changes with the active theme.
- Main controls remain readable:
  - input;
  - textarea;
  - checkbox;
  - radio group;
  - select;
  - button;
  - link.
- Open select dropdowns above nearby groups and verify menu options are not clipped or hidden behind the next section.
- Internal theme clicks do not trigger fresh `/api/llm/generate*` requests.
- Generated source does not contain raw styling:
  - `style`;
  - `className`;
  - `css`;
  - named colors;
  - `rgb(...)`;
  - `hsl(...)`;
  - `var(...)`;
  - `url(...)`.

### Optional follow-up prompt

```txt
Make the buttons switch between light and dark themes. The theme must affect every element, including the theme block.
```

### Expected

- Whole app visually changes after switching theme.
- Theme block also changes.
- No LLM call happens on theme button clicks.

## Scenario 5 — Inputs and validation

### Prompt

```txt
Create a form with name, email, quantity, due date, description and required agreement checkbox. Add basic validation.
```

### Expected

- Name uses text input.
- Email uses email input.
- Quantity uses number input.
- Due date uses date input.
- Description uses textarea.
- Agreement uses checkbox.
- Freshly committed required controls are not red before the user touches them or presses a primary submit/next button.
- Required validation is visible.
- Validation marks invalid controls with error styling and `aria-invalid` without inserting inline error text that shifts layout.
- In multi-screen flows, a primary submit/next button only lights up invalid controls from the current screen, not hidden or unrelated screens.
- Email validation works.
- Number validation works if min/max is generated.
- Due date stores a `YYYY-MM-DD` value.
- Validation changes do not trigger fresh `/api/llm/generate*` requests.
- No arbitrary JS validators are generated.

## Scenario 6 — Collections and filtering

### Prompt

```txt
Create a task list with completed status and a filter with All, Active and Completed.
```

### Expected

- User can add multiple items.
- Completion is interactive through an explicit persisted mutation plus refresh flow, using an action-mode row `Checkbox` with relay-variable context such as `@Set($targetId, item.id)`, `@Run(toggleItem)`, and `@Run(items)` instead of assuming plain `Checkbox(item.completed)` writes directly into `app.items`.
- Controls inside `@Each(...)` must not bind directly to `item.<field>` without an explicit `Action([...])`; otherwise the draft should repair or stay blocked instead of committing a non-persisting row editor.
- If the model drafts `Checkbox`, `RadioGroup`, or `Select` with both `Action([...])` and a writable `$binding`, the builder can send repair requests up to `repair.maxRepairAttempts` before commit (default: 2 attempts); if the repaired draft still has that issue, fail cleanly and leave `Repeat` enabled.
- Row actions use collection-item tools such as `append_item`, `toggle_item_field`, `update_item_field`, or `remove_item` when the list stores object rows.
- Persisted rows keep meaningful unique stable ids; blank, whitespace, or duplicate `value.id` drafts should not survive commit as row ids and should be replaced by generated stable ids.
- The committed source does not mutate persisted array rows by numeric paths such as `app.items.0`; item updates stay id-based through collection-item tools.
- Any row action references top-level `Query(...)` and `Mutation(...)` statements; inline tool calls inside `@Each(...)` should surface Definition issues instead of committing silently.
- After persisted add and complete mutations, the visible `Query("read_state", ...)` re-runs later in the same `Action(...)`; the app must not commit a stale visible query flow.
- If the filter is implemented with action-mode `Select(...)` or `RadioGroup(...)`, the source routes the newly selected option through runtime-managed `$lastChoice` into a top-level persisted mutation instead of assuming direct binding write-back.
- All filter shows all items.
- Active filter shows incomplete items.
- Completed filter shows completed items.
- Switching filters does not trigger fresh `/api/llm/generate*` requests.
- No parser/runtime errors.

## Scenario 7 — Safe compute tools

### Prompt

```txt
Add a button that rolls a random number from 1 to 100 and shows the result.
```

### Expected

- Button click produces a number locally.
- Result is between 1 and 100.
- Definition uses the persisted compute recipe: `Mutation("write_computed_state", ...)`, `Query("read_state", ...)`, and a button `Action(...)` that runs both.
- The action re-runs the visible `Query("read_state", ...)` after the persisted mutation, even if other steps such as `@Reset(...)` or `@Set(...)` also exist in the action.
- Visible result text reads the re-queried persisted value instead of a raw mutation object.
- The re-queried `read_state` result is treated as the raw persisted primitive or `null`, not as a `{ value }` object.
- Result displays as a primitive value, not `[object Object]`.
- Button click does not trigger fresh `/api/llm/generate*` requests.
- No arbitrary JS appears.

### Optional follow-up prompt

```txt
Show a warning if the name field is empty.
```

### Expected

- Warning appears/disappears locally while editing input.
- No arbitrary JS appears.

## Scenario 8 — Persistence, reload, undo and redo

### Steps

1. Generate any working app.
2. Interact with Preview:
   - fill input;
   - select option;
   - toggle checkbox;
   - switch screen/theme/filter if available.
3. Reload browser page.
4. Apply one follow-up change through chat.
5. Click `Undo`.
6. Click `Redo`.

### Expected

- App restores after reload.
- Relevant runtime/domain state restores.
- The follow-up commit may reset local runtime state instead of migrating screen/form variables across source versions.
- Undo restores previous committed app.
- Redo restores redone app.
- While a generation is still running, the chat toolbar previous-version, next-version, and reset buttons are disabled; use `Cancel` before changing builder history.
- No rejected draft becomes committed after reload.
- No stale runtime error remains visible after a valid source change.

## Scenario 9 — JSON import/export and invalid import recovery

### Valid import/export

1. Generate an app.
2. Export JSON.
3. Reset app.
4. Import exported JSON.

Expected:

- App restores.
- Preview and Definition are consistent.
- If import starts while a generation is still running, the generation is cancelled and a late response does not overwrite the imported app.
- Builder chat context starts fresh for the imported app; stale pre-import user requests are not sent on the next generation.
- No parser/runtime errors.

### Invalid import

1. Modify exported JSON so the OpenUI source is invalid.
2. Import invalid JSON.

Expected:

- Import is rejected.
- Invalid import shows a single clear failure message.
- Preview remains on last committed valid app.
- Definition shows rejected source or validation issues.
- Chat/history/runtime/domain state are not wiped.
- App does not crash.

## Scenario 10 — Draft issues and auto-repair

### Prompt

```txt
Create a complex app with two screens, filtering, a random number button, validation, and a dark theme.
```

### Expected

- If the first draft is invalid, or valid but fails a blocking product-quality check, repair attempts may run up to `repair.maxRepairAttempts` (default: 2 attempts).
- Blocking product-quality issues such as `reserved-last-choice-outside-action-mode`, `control-action-and-binding`, `undefined-state-reference`, stale persisted-query refresh, missing multi-screen flow gating, missing control-showcase controls, or non-persisting row controls should use that repair path instead of failing immediately on the first draft.
- Parser-invalid drafts should use the same repair path instead of being rewritten locally in the browser.
- If repair runs, chat keeps one pending assistant summary card with shimmer and changes its text to `Something went wrong and your request was sent again`, or `Something went wrong and your request was sent again (2)` for the second repair attempt.
- Each automatic repair request should add model context that the previous draft was rejected, with a message like `Previous draft rejected due to: <codes>`, and the backend repair prompt should include that context before asking for the corrected source.
- The repair request sent to the model must be role-based: recent filtered conversation context appears in the user repair-context message as bounded `<conversation_context>` when available, the rejected model draft appears in an assistant message as `<model_draft_that_failed>`, and the final user message contains `<validation_issues>` plus targeted hints before asking for the corrected `source`.
- Repair validation issues may carry optional `severity`; blocking/fatal/warning priority must stay consistent between frontend repair selection and backend repair-prompt issue ordering.
- For `undefined-state-reference`, the repair request must carry structured issue context for the missing ref name and optional initializer example; the backend repair hint should not rely on parsing the issue message text.
- For `quality-stale-persisted-query`, the repair request must carry structured issue context as `context.statementId` plus `context.suggestedQueryRefs`; the backend repair hint should not rely on parsing the issue message text.
- For `quality-options-shape`, the repair request must carry structured issue context as `context.groupId` plus `context.invalidValues`; the backend repair hint should not rely on parsing the issue message text.
- If repair succeeds, the final app is valid and usable.
- If repair fails, the pending summary card is removed, the previous Preview remains visible, `Repeat` stays available, and a red error card shows `Something went wrong and your request couldn’t be completed. The previous valid app was kept. Please retry.` with expandable `Details` for the technical validation/error text. Repair request failures may include technical code/status/message metadata in `Details`.
- If repair fails because the repair request itself times out, the error text should explicitly mention the automatic repair timing out rather than a generic initial-generation timeout.
- Partial or bad draft is not committed.
- The UI does not get stuck in loading/generating state.
- If a clearly fatal structural draft occurs instead, such as nested `AppShell`, `Screen` inside `Screen`, or `Repeater` inside `Repeater`, the builder should fail cleanly without an automatic repair attempt.

## Scenario 11 — Standalone HTML export

Skip if standalone export is intentionally disabled.

### Steps

1. Generate a small app with:
   - input;
   - button action;
   - local state.
2. Download standalone HTML.
3. Open downloaded file directly.

### Expected

- Standalone file shows only generated app UI.
- No Kitto builder shell.
- No chat panel.
- No backend status.
- No `/api/*` or `/api/llm/*` requests.
- Local interactions work.
- Standalone state persists after reload.
- Reset local data restores embedded baseline.
- If the file is opened from `file://`, root-relative app links and hash/self links stay inert instead of navigating the local filesystem.
- If MCP tooling cannot open the local `file://` runtime, at minimum verify that the download succeeds and the HTML contains the embedded app payload for later manual opening.

## Scenario 12 — Cancel and stale request recovery

### Steps

1. Send a long prompt.
2. Click `Cancel` while generation is running.
3. Send a new simple prompt:

   ```txt
   Create a simple counter app.
   ```

### Expected

- Cancel stops generation.
- Chat toolbar previous-version, next-version, and reset buttons stay disabled until the generation is cancelled or otherwise finishes.
- No scary red error appears for intentional cancel.
- One neutral system chat message confirms that the user cancelled the in-flight generation.
- The cancelled user prompt remains visible in chat but is excluded from the next `/api/llm/generate*` `chatHistory` payload.
- Partial draft is not committed.
- Late response does not overwrite the current app.
- New prompt works.
- The app does not stay stuck in `Generating...` or `Updating...`.

## Final quick checks

After smoke:

- no uncaught Console errors;
- preview internal clicks do not trigger fresh `/api/llm/generate*` requests;
- obviously oversized requests are blocked in the UI with a clear error before any `/api/llm/*` generation request is sent;
- invalid drafts/imports do not replace committed preview;
- import/export works;
- undo/redo works;
- reload restores app state;
- colors/theme remain readable;
- filtering works locally;
- compute actions work locally;
- the runtime-config status is not shown as a header badge;
- the prompts reference page matches the current backend prompt snapshot.

## Separate Report

If the smoke run needs a written result, use `docs/qa/openui-agent-smoke-report.md`.
Do not append run results directly to this checklist.

## Intentionally excluded from smoke

Do not test here:

- deployment;
- PM2;
- Docker;
- Nginx;
- production route fallback;
- full safe URL matrix;
- full path hardening matrix;
- complete backend API contract;
- deep implementation details not required by the scenarios.
