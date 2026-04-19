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

## Scenario 3 — Follow-up edit

Prompt:

Add a required checkbox confirmation before the result screen.

Expected:
- the existing intro -> question -> result flow is preserved rather than regenerated into a different app shape
- while the follow-up request runs, the Preview overlay label changes to `Updating...`
- a required checkbox appears before the user can reach the result
- navigation still works end-to-end, including restart
- no unresolved refs, parser errors, or broken actions appear

## Scenario 4 — Collection / Repeater

Prompt:

Add a result screen section that lists all selected answers as a collection.

Expected:
- generated source uses `Repeater` or another explicit repeated-row pattern for the collection
- because this smoke test only answers one question, the collection may contain one row, but it should still be modeled as a collection rather than a hardcoded summary line
- no todo-specific or unrelated domain assumptions appear
- no parser errors appear

## Scenario 5 — Import/export

Actions:
1. Click `Export` and save the downloaded `kitto-definition-*.json` file.
2. Click `Reset`.
3. Click `Import` and select the exported definition.

Expected:
- the imported file validates before it is applied
- after import, Preview, Definition, runtime state, and persisted data restore coherently
- no runtime crash or parser error appears

Follow-up:
1. Edit the exported JSON so `source` becomes invalid OpenUI.
2. Import the broken file.

Expected:
- an import error appears
- Definition shows the rejected imported source and validation issues
- Preview stays on the last committed valid app
- runtime state and persisted data stay on the last committed snapshot
- chat history is not wiped by the failed import
- undo/redo history is not replaced by the failed import

## Scenario 6 — Undo/redo

Actions:
1. Generate an app.
2. Apply one follow-up change and wait for it to commit.
3. Click `Undo`.
4. Click `Redo`.

Expected:
- undo restores the previous committed source and its runtime/domain snapshot
- redo restores the later committed source
- Definition reflects the restored committed snapshot after each action
- no stale draft source or rejected-definition state remains after undo/redo

## Scenario 7 — Abort and stale-request safety

Actions:
1. Submit a prompt that should generate for at least a few seconds.
2. Before it finishes, navigate to `http://localhost:5555/elements`.
3. Wait a moment, then return to `http://localhost:5555/chat`.

Expected:
- no red abort error is appended to chat history
- Preview and Definition still reflect the last committed valid app rather than a partial streamed draft
- no late commit from the aborted request appears after returning to `/chat`
- the aborted request does not overwrite any later committed app state
