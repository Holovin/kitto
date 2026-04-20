# Kitto OpenUI Agent Smoke Test

## Purpose

This file is for a fast browser/MCP smoke pass after meaningful changes to the OpenUI runtime, prompt, component library, validation, standalone export, or streaming lifecycle.

This is not a full regression suite. Full invariants and edge cases live in `docs/qa/openui-manual-checklist.md`.

## Setup

1. Start the app:

   ```bash
   npm run dev
   ```

2. Open `http://localhost:5555/chat`.
3. Wait until the backend status in the header becomes `connected`.
4. Open DevTools:
   - `Console` for runtime and parser errors.
   - `Network` filtered to `/api/llm` so it is easy to see when the LLM is called and when it is not.

## MCP automation notes

- In the chat composer, prompts should be entered with real typing into the `textarea` via `type_text` after focusing the field.
- Do not use DOM-only `fill`, because React may not update state and may leave `Send` disabled.
- For import/export, if the OS file picker is unavailable, it is acceptable to verify the same frontend import path through the hidden `input[type="file"]` by creating a `File` programmatically and dispatching `change`.

## Scenario 1 — Basic generation and local screen flow

Prompt:

```txt
Create a three-screen quiz app with intro, one question, and result screen. Use radio buttons, a Next button, and a Restart button.
```

Expected:

- During generation, Preview stays on the last committed app or the empty state.
- After commit, the intro screen is visible.
- There are no parser or runtime errors in the UI or Console.
- Definition contains OpenUI source.
- The internal flow works locally:
  1. `Start` or `Begin`
  2. select a radio option
  3. `Next`
  4. `Restart`
- After internal clicks, there are no new `/api/llm/generate` or `/api/llm/generate/stream` requests.
- If you inspect Definition, screen flow uses local state such as `$currentScreen` plus `@Set(...)`, not a persisted navigation tool.

## Scenario 2 — Follow-up edit preserves existing app

Prompt:

```txt
Add a required checkbox confirmation before the result screen.
```

Expected:

- The existing `intro -> question -> result` flow is preserved.
- A new checkbox appears before the result or submit step.
- The checkbox actually affects the flow or validation.
- Navigation still works end-to-end.
- Preview updates only after commit.
- If the first draft is invalid and repair runs, that is acceptable, but the final version must be valid.
- There are no unresolved refs, parser errors, or broken actions.

## Scenario 3 — Theme / appearance / active button

Prompt:

```txt
Build an app with every control you know. Add a separate top group with two buttons for light and dark themes. The active theme must be shown as a RED button with white text.
```

Expected:

- There are two theme buttons.
- The active theme is shown as a red button with white text.
- The inactive button is not red.
- Clicking the theme buttons changes the active button locally without `/api/llm/*`.
- Theme state affects real app colors, not just labels.
- The shared theme is defined at the top level through `appTheme` and `AppShell([...], appTheme)`, rather than by repeating the same colors on every control.
- `Definition` follows the canonical theme recipe with `$currentTheme`, `lightTheme`, `darkTheme`, `appTheme`, `activeThemeButton`, and `inactiveThemeButton`.
- Inputs, selects, and radio groups inherit the shared `AppShell` theme instead of receiving duplicated per-control `appearance`.
- All main controls remain readable.
- Generated source does not contain:
  - `style`
  - `className`
  - `css`
  - named colors
  - `rgb(...)`
  - `hsl(...)`
  - `var(...)`
  - `url(...)`

Follow-up prompt:

```txt
Make the buttons switch the theme between light and dark. The theme must affect all elements, including the theme block itself.
```

Expected:

- The whole page changes visually when the theme is switched.
- The theme block also changes together with the app.
- Local overrides are used only where a special color is needed, for example the active button.
- The inactive theme button falls back to `appTheme` instead of carrying a separate hard-coded control theme.
- There is no repeat LLM request after clicking theme buttons.

## Scenario 4 — Inputs and validation

Prompt:

```txt
Create a form with name, email, phone, quantity, due date, description and required agreement checkbox. Add basic validation.
```

Expected:

- Appropriate input types are used:
  - `email` for email
  - `tel` for phone
  - `number` for quantity
  - `date` for due date
  - `textarea` for description
  - `checkbox` for agreement
- Required validation is visible for required fields.
- Email validation works for an invalid email.
- Number validation works for quantity if the prompt asks for `min/max`.
- Due date is stored as `YYYY-MM-DD`.
- Validation works locally without LLM requests.
- Generated source does not contain arbitrary JS validators, `eval`, `Function`, regex-code, or script-like strings.

## Scenario 5 — Collection, Repeater and filtering

Prompt:

```txt
Create a task list with checkboxes for completed items and a filter with All, Active and Completed.
```

Expected:

- Multiple items can be added.
- An item can be marked completed.
- There is filter state, for example `$filter`.
- Switching `All` / `Active` / `Completed` changes visible rows locally.
- There are no new `/api/llm/*` requests when switching the filter.
- Source uses supported OpenUI collection helpers:
  - `@Each(...)`
  - `Repeater(...)`
  - `@Filter(collection, field, operator, value)` if filtering is needed
- Source does not use predicate-form filtering such as:

  ```txt
  @Filter(items, "item", item.completed == true)
  ```

- No new filtering-specific tool such as `select_state` appears.

## Scenario 6 — Safe compute tools

Prompt:

```txt
Add a button that rolls a random number from 1 to 100 and shows the result.
```

Expected:

- Source uses a safe compute tool:
  - `compute_value`
  - or `write_computed_state` if the result needs to be stored
- For a random integer it uses `op: "random_int"` with integer `min` / `max`.
- Clicking the button updates the number locally.
- There are no new `/api/llm/*` requests after the click.
- The result is shown as a primitive value, not `[object Object]`.
- There is no arbitrary JS, `eval`, `Function`, or script-like content.

Follow-up prompt:

```txt
Show a warning if the name field is empty.
```

Expected:

- It uses a built-in expression or `compute_value`.
- The warning appears and disappears locally while typing.
- There is no arbitrary JS validation.

## Scenario 7 — JSON import/export and standalone HTML export

### JSON export/import

1. Generate an app.
2. Click `Export JSON`.
3. Save the file.
4. Click `Reset`.
5. Click `Import JSON` and choose the exported file.

Expected:

- Import validates source before applying it.
- Preview, Definition, runtime state, and persisted data restore coherently.
- There is no runtime crash or parser error.

### Invalid import check

1. Edit the exported JSON so that `source` becomes invalid.
2. Import the broken file.

Expected:

- An import error is shown.
- Definition shows the rejected source and validation issues.
- Preview stays on the last committed valid app.
- Chat/history/runtime/domain state is not reset.

### Standalone HTML export

1. Generate an app.
2. Click `Download standalone HTML`.
3. Open the downloaded `.html` file directly.

Expected:

- The standalone file shows only the generated app UI.
- There is no Kitto builder shell.
- There is no chat panel.
- There is no backend status.
- There are no `/api/*` or `/api/llm/*` requests.
- Internal clicks work.
- After changing state and reloading the standalone file, it restores its own `localStorage` state.
- `Reset local data` returns the standalone app to the embedded baseline.

## Scenario 8 — Cancel, timeout and stale request safety

### Cancel

1. Send a prompt that takes several seconds to generate.
2. Click `Cancel` while generation is in progress.

Expected:

- The `Generating...` or `Updating...` state clears quickly.
- A red intentional-cancel error is not added to chat.
- Preview stays on the last committed valid app.
- A partial streamed draft is not committed.
- A late response from the cancelled request does not overwrite the current app.

### Abort on navigation

1. Send a long prompt.
2. Before it completes, navigate to `/elements`.
3. Return to `/chat`.

Expected:

- There is no red abort error in chat.
- There is no late commit from the old request.
- Preview and Definition show the last committed valid app.
- The builder does not remain stuck in `Generating...`.

## Final quick checks

After the smoke pass, verify:

- There are no console errors.
- All internal preview clicks work without LLM requests.
- Definition does not contain raw CSS or arbitrary JS.
- Preview renders committed source only.
- `Undo` and `Redo` work for at least one follow-up change.
- `Reset` returns the builder to the expected empty state.

What is intentionally excluded from smoke:

- detailed route fallback checks
- PM2 / Docker deploy checks
- the full safe URL matrix
- all path hardening edge cases
- the full runtime issue lifecycle
- deeper import/export variants

These still matter, but they belong in the regression/manual checklist rather than the fast agent smoke. Those remain in `docs/qa/openui-manual-checklist.md`.
