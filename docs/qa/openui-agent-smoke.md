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

3. Wait until the backend status in the header is `connected`.
4. Open DevTools:
   - `Console` for runtime/parser errors.
   - `Network` filtered to `/api/llm` to verify which interactions call the LLM.
5. While a generation is streaming, Chat should surface a human-readable pending assistant summary such as `Building: ...`, and Definition should show only parsed OpenUI source text rather than the raw structured JSON envelope.
6. In `/api/llm/generate*` responses, confirm the final envelope includes both `summary` and `notes` (`notes` may be an empty array).
7. For trivial validation problems such as misordered `Group(...)` args or legacy appearance keys, watch `Console` for a local `auto-fixed locally` log and confirm no extra repair LLM request is sent.

## MCP automation notes

- Type prompts into the chat textarea with real typing after focus.
- Do not use DOM-only fill.
- For import, if the OS picker is unavailable, it is acceptable to use the hidden `input[type="file"]` with a generated `File`.

## Scenario status values

Use one of these statuses for each scenario report entry:

- `pass`: the scenario was exercised end-to-end and behaved as expected.
- `fail`: the scenario was exercised and the product/runtime behaved incorrectly.
- `not verified`: the scenario could not be completed only because of MCP/browser tooling limits, and there is not yet evidence of a product/runtime failure.

`not verified` does not block the overall smoke pass by itself. It means manual follow-up is still required.

## Scenario 1 — Simple todo stays simple

### Prompt

```txt
Create a todo list.
```

### Expected

- The app commits successfully.
- While the request is streaming, chat shows one human-readable pending assistant summary before commit.
- The app has a simple todo UI:
  - task input;
  - add button;
  - task list.
- User can add a task.
- Internal todo interactions do not call `/api/llm/*`.
- Definition does not show `Todo request did not generate required todo controls.`.
- No parser/runtime errors appear.
- The app does not add unrelated features such as:
  - theme toggle;
  - due dates;
  - filtering;
  - compute tools;
  - extra screens;
  unless the model has a strong product reason and the UI still works.

### Report notes

Record:

- pass/fail;
- whether repair happened;
- whether the pending summary appeared before commit;
- whether the app was overcomplicated;
- whether the missing-controls warning appeared;
- whether add task worked.

## Scenario 2 — Multi-screen local flow

### Prompt

```txt
Create a three-screen quiz app with intro, one question, and result screen. Use radio buttons, a Next button, and a Restart button.
```

### Expected

- Intro screen appears after commit.
- Start/Begin works.
- Radio selection works.
- Next works.
- Restart works.
- Internal clicks do not call `/api/llm/*`.
- No parser/runtime errors.

### Report notes

Record:

- pass/fail;
- whether all screen transitions worked;
- whether local clicks triggered LLM unexpectedly.

## Scenario 3 — Follow-up edit preserves existing app

### Prompt

```txt
Add a required checkbox confirmation before the result screen.
```

### Expected

- Existing quiz flow remains usable.
- Checkbox appears before result/submit.
- Checkbox affects the flow or validation.
- The pre-commit chat summary stays readable and the committed assistant summary remains in chat after success.
- Final committed source is valid.
- If repair runs, final repaired app still works.
- No broken actions or unresolved refs.

### Report notes

Record:

- pass/fail;
- whether repair happened;
- whether the summary stayed in chat after commit;
- whether existing flow survived.

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
- Main controls remain readable:
  - input;
  - textarea;
  - checkbox;
  - radio group;
  - select;
  - button;
  - link.
- Internal theme clicks do not call `/api/llm/*`.
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

### Report notes

Record:

- pass/fail;
- whether active button styling worked;
- whether the active red/white button was correct on the first commit;
- whether all controls remained readable;
- whether theme required too many manual corrections.

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
- Validation changes do not call `/api/llm/*`.
- No arbitrary JS validators are generated.

### Report notes

Record:

- pass/fail;
- which input types appeared;
- whether validation worked;
- whether arbitrary JS appeared.

## Scenario 6 — Collections and filtering

### Prompt

```txt
Create a task list with completed status and a filter with All, Active and Completed.
```

### Expected

- User can add multiple items.
- Completion should be interactive through an explicit persisted mutation + refresh flow, using an action-mode row `Checkbox` with relay-variable context such as `@Set($targetId, item.id)`, `@Run(toggle_item_field)`, and `@Run(read_state)` instead of assuming plain `Checkbox(item.completed)` writes directly into `app.items`.
- Controls inside `@Each(...)` must not bind directly to `item.<field>` without an explicit `Action([...])`; otherwise the draft should repair or stay blocked instead of committing a non-persisting row editor.
- If the model drafts `Checkbox`, `RadioGroup`, or `Select` with both `Action([...])` and a writable `$binding`, the builder should send one repair request before commit; if the repaired draft still has that issue, fail cleanly and leave `Repeat` enabled.
- Row actions should use collection-item tools such as `append_item`, `toggle_item_field`, `update_item_field`, or `remove_item` when the list stores object rows.
- The committed source must not mutate persisted array rows by numeric paths such as `app.items.0`; item updates should stay id-based through collection-item tools.
- Any row action must reference top-level `Query(...)` / `Mutation(...)` statements; inline tool calls inside `@Each(...)` should surface Definition issues instead of committing silently.
- Definition re-runs the visible `Query("read_state", ...)` after persisted add and complete mutations.
- If the filter is implemented with action-mode `Select(...)`, the source should route the newly selected option through runtime-managed `$lastChoice` into a top-level persisted mutation instead of assuming direct binding write-back.
- All filter shows all items.
- Active filter shows incomplete items.
- Completed filter shows completed items.
- Switching filters does not call `/api/llm/*`.
- No parser/runtime errors.

### Report notes

Record:

- pass/fail;
- whether add/filter worked;
- whether completion toggled interactively and refreshed the visible query;
- whether any LLM request happened during local filter interactions.

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
- Result displays as a primitive value, not `[object Object]`.
- Button click does not call `/api/llm/*`.
- No arbitrary JS appears.

### Optional follow-up prompt

```txt
Show a warning if the name field is empty.
```

### Expected

- Warning appears/disappears locally while editing input.
- No arbitrary JS appears.

### Report notes

Record:

- pass/fail;
- whether random result worked;
- whether warning worked;
- whether local clicks triggered LLM.

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
- Undo restores previous committed app.
- Redo restores redone app.
- If undo or redo starts while a generation is still running, the generation is cancelled first and a late response does not overwrite the restored version.
- No rejected draft becomes committed after reload.
- No stale runtime error remains visible after a valid source change.

### Report notes

Record:

- pass/fail;
- what state survived reload;
- whether undo/redo worked.

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

### Report notes

Record:

- pass/fail;
- whether valid import worked;
- whether invalid import was safely rejected.

## Scenario 10 — Draft issues and auto-repair

### Prompt

```txt
Create a complex app with two screens, filtering, a random number button, validation, and a dark theme.
```

### Expected

- If first draft is invalid, or valid but fails a blocking product-quality check, one repair attempt may run.
- Trivial parser issues with local `suggestion` patches may be fixed in the browser before repair; in that case no repair request should run.
- If repair succeeds, final app is valid and usable.
- If repair fails, previous Preview remains visible.
- Partial or bad draft is not committed.
- UI does not get stuck in loading/generating state.

### Report notes

Record:

- pass/fail;
- whether a local auto-fix happened before repair;
- whether repair happened;
- whether repair succeeded;
- whether Preview stayed stable.

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

### Standalone status rules

- Record `not verified` when the standalone artifact downloads successfully and the HTML contains the embedded app payload, but MCP tooling cannot open the local `file://` runtime.
- Record `pass` when the standalone file is opened and the runtime works as expected.
- Record `fail` when the standalone file is opened but the runtime is broken, or when the export artifact/payload is missing.

### Report notes

Record:

- pass/fail/not verified;
- whether standalone opened offline;
- whether standalone localStorage worked.
- any manual follow-up still required, especially when `not verified` was caused by MCP not opening `file://`.

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
- No scary red error appears for intentional cancel.
- One neutral system chat message confirms that the user cancelled the in-flight generation.
- Partial draft is not committed.
- Late response does not overwrite current app.
- New prompt works.
- App does not stay stuck in `Generating...`.

### Report notes

Record:

- pass/fail;
- whether cancel worked;
- whether new generation worked.

## Final quick checks

After smoke:

- no uncaught Console errors;
- preview internal clicks do not call LLM;
- obviously oversized requests are blocked in the UI with a clear error before any `/api/llm/*` call is sent;
- invalid drafts/imports do not replace committed preview;
- import/export works;
- undo/redo works;
- reload restores app state;
- colors/theme remain readable;
- filtering works locally;
- compute actions work locally.

## Reporting

After running smoke, write the result to:

`docs/qa/openui-agent-smoke-report.md`

Use the template from that file.

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
