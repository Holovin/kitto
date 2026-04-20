# Kitto OpenUI Agent Smoke Test

## Setup

1. Start the app with `npm run dev`.
2. Open `http://localhost:5555/chat`.
3. Wait for the status badge to change from `Backend model: loading...` to `Backend model: <model>`. If it shows `Backend model: unavailable`, fix the backend before continuing.
4. Keep the browser DevTools Console visible to catch parser or runtime errors.
5. Keep the DevTools Network tab open and filter by `/api/llm` so it is easy to verify when generation requests do and do not happen.

## MCP Automation Notes

- For Chrome DevTools MCP automation, enter prompts in the composer `textarea` with real keyboard typing (`type_text`) after focusing the field. Do not rely on DOM-only value injection or `fill` for this control; React may keep `Send` disabled if the change does not arrive as real typed input.
- For import smoke tests under MCP automation, the native OS file picker may be unavailable. It is acceptable to verify the same frontend import path by creating a `File`, assigning it to the hidden `input[type="file"]`, and dispatching the input `change` event.

## Scenario 1 — Basic app generation

Prompt:

Create a three-screen quiz app with intro, one question, and result screen. Use radio buttons, a Next button, and a Restart button.

Expected:
- while generation is in progress, the Preview panel shows a semi-transparent overlay with a spinner and the label `Generating...`
- while generation streams, Preview stays on the last committed app; if the canvas was empty, it should stay on the empty state until commit
- after commit, an intro screen is visible and interactive
- no parser or runtime errors appear in the app UI or Console
- the only LLM request is the chat submission itself; internal app buttons must not trigger extra generation requests

## Scenario 2 — Local clicks without LLM

Actions:
1. Click the intro CTA (`Start`, `Begin`, or equivalent).
2. Pick a radio option.
3. Click `Next`.
4. Click `Restart`.

Expected:
- screen changes are immediate
- no new `/api/llm/generate` or `/api/llm/generate/stream` request is made after Scenario 1 has finished
- no runtime errors appear
- navigation is handled locally in runtime state rather than by rebuilding the definition
- if you inspect `Definition`, screen flow uses local `$currentScreen` state with `@Set(...)` rather than persisted tool calls

Follow-up:
1. Reload the page.

Expected:
- the last committed app still renders after reload
- the selected radio option and current screen restore from persisted runtime state
- existing chat history and undo/redo history remain available after reload

## Scenario 3 — Follow-up edit

Prompt:

Add a required checkbox confirmation before the result screen.

Expected:
- the existing intro -> question -> result flow is preserved rather than regenerated into a different app shape
- while the follow-up request runs, the Preview overlay label changes to `Updating...`
- a required checkbox appears before the user can reach the result
- navigation still works end-to-end, including restart
- any previous Preview runtime issue clears once the new committed valid source renders
- no unresolved refs, parser errors, or broken actions appear

## Scenario 4 — Inline group layout

Prompt:

Create a form with name, email, and due date fields in one visual section, with fields arranged in inline groups.

Expected:
- generated source contains one outer section `Group(...)` using the default block styling or an explicit `"block"` variant
- generated source uses one or more inner `Group(..., "horizontal", [...], "inline")` rows for the fields or controls
- the rendered UI shows one section rather than nested card-in-card surfaces
- no parser errors or unresolved refs appear

## Scenario 5 — Collection / Repeater / filtering

Prompt:

Create a quiz and show selected answers on the result screen as a list.

Expected:
- generated source contains `Repeater(`
- generated source builds rows with `@Each(`
- if the result rows read persisted data, they come from `Query("read_state", ...)`; otherwise they come from a local array or runtime-derived collection
- because this smoke test may end up with only one selected answer, it should still be modeled as a collection rather than a hardcoded summary line
- no hardcoded selected answer values appear when the list should reflect runtime data
- no unresolved refs appear
- no todo-specific or unrelated domain assumptions appear
- no parser errors appear

Follow-up prompt:

Add a filter control so the app can show all items, active items, and completed items.

Expected:
- generated source uses built-in collection helpers such as `@Filter(` and `@Count(` rather than inventing a new tool
- the filtered view is derived from one source collection instead of duplicating separate hardcoded lists
- filtered rows still render through `@Each(` plus `Repeater(`
- no todo-specific filter tool names or custom filtering APIs appear
- no parser errors or unresolved refs appear

## Scenario 6 — JSON import/export

Actions:
1. Click `Export JSON` and save the downloaded `kitto-definition-*.json` file.
2. Click `Reset`.
3. Click `Import JSON` and select the exported definition.

Expected:
- the imported file validates before it is applied
- successful JSON export appends a success message at the end of chat history
- after import, Preview, Definition, runtime state, and persisted data restore coherently
- no runtime crash or parser error appears

Follow-up:
1. Edit the exported JSON so `source` becomes invalid OpenUI.
2. Import the broken file.

Expected:
- an import error appears
- Definition shows the rejected imported source and validation issues
- Preview stays on the last committed valid app
- if there is no last committed valid app to fall back to, Preview shows `Preview is unavailable` with light error styling instead of the normal empty state
- runtime state and persisted data stay on the last committed snapshot
- chat history is not wiped by the failed import
- undo/redo history is not replaced by the failed import

## Scenario 7 — Standalone HTML export

Actions:
1. Generate a quiz app and interact with it so runtime state changes from the initial screen.
2. Open the file menu and click `Download standalone HTML`.
3. Open the downloaded `.html` file directly from disk.

Expected:
- the standalone file shows only the generated app UI plus the small reset control
- clicking `Download standalone HTML` appends a success message at the end of chat history
- no builder shell, chat panel, backend status, or API key UI appears
- the app starts from the committed snapshot baseline state rather than the live clicked builder state from step 1
- the standalone file makes no `/api/llm/*` or other `/api/*` requests

Follow-up:
1. Click through the standalone app so its runtime/domain state changes.
2. Reload the standalone file.
3. Click `Reset local data`.

Expected:
- reloading restores the standalone app’s own saved runtime/domain state from localStorage
- `Reset local data` clears the standalone storage key and returns the app to the embedded baseline state
- resetting does not affect the main Kitto builder state in the original tab

## Scenario 8 — Undo/redo

Actions:
1. Generate an app.
2. Apply one follow-up change and wait for it to commit.
3. Click `Undo`.
4. Click `Redo`.

Expected:
- undo restores the previous committed source and its runtime/domain snapshot
- redo restores the later committed source
- the chat toolbar shows `Version: N / M` followed by previous-version and next-version buttons, and that label updates in lockstep with history position, for example `Version: 1 / 2` after undo and `Version: 2 / 2` after redo
- if you undo all the way back to the blank canvas while prior versions still exist, the `Version:` label shows `0 / M`, the previous-version button stays disabled, and `Reset` stays enabled
- `Reset` is disabled only on a pristine empty builder after a fresh open or after `Reset`
- `Reset` stays enabled whenever committed preview content exists, version history exists, or a rejected cached/imported definition is visible
- the chat keeps only one rewind-status system message; repeated `Undo`/`Redo` updates that one message instead of stacking a ladder of history notices
- the rewind-status system message includes the visible version number
- Definition reflects the restored committed snapshot after each action
- no stale draft source or rejected-definition state remains after undo/redo

## Scenario 9 — Cancel, abort, and stale-request safety

Actions:
1. Submit a prompt that should generate for at least a few seconds.
2. Click `Cancel` while the request is still in progress.

Expected:
- the `Generating...` or `Updating...` state clears promptly instead of hanging
- no red cancel or abort error is appended to chat history
- Preview and Definition still reflect the last committed valid app rather than a partial streamed draft
- no late commit from the cancelled request appears after waiting a moment

Follow-up:
1. Submit another prompt that should generate for at least a few seconds.
2. Before it finishes, navigate to `http://localhost:5555/elements`.
3. Wait a moment, then return to `http://localhost:5555/chat`.

Expected:
- no red abort error is appended to chat history
- Preview and Definition still reflect the last committed valid app rather than a partial streamed draft
- no late commit from the aborted request appears after returning to `/chat`
- the aborted request does not overwrite any later committed app state

Failure-path note:
- if a generation fails because the model still returns invalid OpenUI after automatic repair, no new version is created
- the final red chat message ends with `An error occurred, a new version was not created. Please try rephrasing your request and run it again.`
- Preview and Definition both continue showing the last committed valid app rather than the rejected draft

## Scenario 10 — Preview runtime issue lifecycle

Actions:
1. Generate or import a committed app that triggers a Preview runtime error.
2. Confirm the Preview area shows `Preview runtime error` instead of crashing the builder shell.
3. Open `Definition`.
4. Commit a valid follow-up source.

Expected:
- Definition shows the current runtime issue for the crashing committed preview only
- switching to the new valid committed source clears the previous runtime issue
- if a rejected imported source is shown in Definition, it does not mix in stale runtime issues from the last committed preview
- the rest of the builder shell stays interactive throughout the crash

## Scenario 11 — Safe color overrides

Prompt:

Add dark mode.

Expected:
- generated source uses `color` and/or `background` props on visible components
- every generated color override uses strict `#RRGGBB` values
- the rendered UI visibly changes to a dark-looking design
- screen titles may use the trailing `Screen(..., isActive?, color?, background?)` overrides when needed
- dark form controls use control-level `color` / `background` props instead of relying only on parent `Screen` or `Group` colors
- no raw CSS, `style`, `className`, named colors, `rgb()`, `hsl()`, `var()`, or `url()` appears in generated source

Follow-up prompt:

Make the warning message yellow and the submit button blue.

Expected:
- generated source uses safe `#RRGGBB` values for the warning message and submit button
- the warning message uses `Text(..., color?)` or a surrounding surface component instead of `Text.background`
- existing component variants still remain valid where they are enough
- no arbitrary CSS or style-object syntax appears in generated source
