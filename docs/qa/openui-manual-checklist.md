# Kitto OpenUI Manual Checklist

## API contract

Supported API:

- `GET /api/health`
- `GET /api/config`
- `POST /api/llm/generate`
- `POST /api/llm/generate/stream`

Guardrails:

- oversized raw `/api/llm/*` request bodies must fail with JSON `413` `validation_error`
- backend model output above the configured byte limit must fail with a controlled `upstream_error`
- `GET /api/config` must expose both frontend-safe request limits and the stream timeout policy used by the builder UI

## Runtime invariants

- Preview renders committed source only.
- While generation is in progress, Preview keeps that committed source (or empty state) visible behind a semi-transparent blocking overlay with a spinner and contextual status label: `Generating...` for the first prompt, `Updating...` for follow-up edits.
- Every generation ends in exactly one terminal state: committed, failed, or cancelled. The builder must never remain stuck in `Generating...` or `Updating...` indefinitely.
- Definition may show streamed draft source while generation is still in progress.
- If a generation fails because the model keeps returning invalid OpenUI, both Preview and Definition must snap back to the last committed valid source as if the failed run never committed.
- Invalid source is never committed to Preview or builder history.
- That invalid-generation chat failure must end with: `An error occurred, a new version was not created. Please try rephrasing your request and run it again.`
- If a rejected cached/imported definition is visible and there is no committed preview source to fall back to, Preview shows `Preview is unavailable` with a light error treatment instead of the normal empty state.
- Frontend stream idle timeout or max-duration timeout must abort the in-flight request, surface a controlled failure message, and keep the last committed Preview visible.
- Preview runtime issues reflect the current committed preview only and clear after a different valid committed source replaces the crashing one.
- Rejected imported source in Definition must not mix in stale runtime issues from the previous committed preview.
- Renderer/component exceptions inside Preview or `/elements` demos must stay contained to a local fallback UI instead of crashing the surrounding shell or route.
- Stale streamed chunks and stale non-streaming fallback responses are ignored and must never overwrite a newer generation request.
- Intentional aborts, including clicking `Cancel` or leaving `/chat` mid-generation, clear the in-progress request without appending a red chat error or committing partial source.
- Invalid import keeps the last committed Preview/runtime/domain state and only surfaces the rejected source in Definition with parse issues.
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
- When a standalone HTML file is opened from `file://`, root-relative app paths such as `/chat` and hash/self links such as `#details` must be treated as invalid/inert instead of attempting local filesystem navigation.
- `toolProvider` is only used by `Query(...)` and `Mutation(...)`.
- Allowed tool names are `read_state`, `write_state`, `merge_state`, `append_state`, and `remove_state`.
- Persisted tool paths must be non-empty dot-paths no deeper than 10 segments.
- Persisted path segments may use only letters, numbers, `_`, or `-`, and must reject `__proto__`, `prototype`, and `constructor`.
- Numeric path segments are valid only when they address array indexes.
- `write_state` and `append_state` values must stay JSON-compatible, `merge_state` patches must stay plain objects, and `remove_state` requires an explicit non-negative integer `index`.
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

Button:

```txt
Button(id, label, variant, action?, disabled?, color?, background?)
```

Screen:

```txt
Screen(id, title, children, isActive?, color?, background?)
```

Group:

```txt
Group(title, direction, children, variant?, color?, background?)
```

Variants:

```txt
block | inline
```

Default:

```txt
block
```

Safe color overrides:

```txt
Text(value, variant, align, color?)
Input(name, label, value?, placeholder?, color?, background?)
TextArea(name, label, value?, placeholder?, color?, background?)
Checkbox(name, label, checked?, color?, background?)
RadioGroup(name, label, value?, options?, color?, background?)
Select(name, label, value?, options?, color?, background?)
Link(label, url, newTab?, color?, background?)
```

Navigation:

```txt
$currentScreen = "intro"
Button("next-button", "Next", "default", Action([@Set($currentScreen, "next")]), false)
```

Collections:

```txt
items = Query("read_state", { path: "quiz.answers" }, [])
rows = @Each(items, "item", Group(null, "vertical", [
  Text(item.label, "body", "start")
], "inline"))
Repeater(rows, "Empty state")
```

Derived filtering:

```txt
$filter = "all"
items = Query("read_state", { path: "app.items" }, [])
visibleItems = $filter == "completed" ? @Filter(items, "completed", "==", true) : $filter == "active" ? @Filter(items, "completed", "==", false) : items
rows = @Each(visibleItems, "item", Group(null, "vertical", [
  Text(item.title, "body", "start")
], "inline"))
Text("Visible: " + @Count(visibleItems), "muted", "start")
Repeater(rows, "Empty state")
```

Do use:

- `Screen(...)` for screen-level sections and `Group(...)` for local layout
- `Group(..., "block")` for standalone visual sections
- `Group(..., "inline")` for lightweight nested groups, inline controls, repeated rows, and groups inside an existing block
- optional trailing `color?` / `background?` on `Screen(...)`
- optional `color?` on `Text(...)`
- optional `color?` / `background?` props on `Group`, `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, and `Link`
- only strict `#RRGGBB` values such as `#111827`, `#F9FAFB`, or `#2563EB` for those color overrides
- when a form control should look dark or light, pass the color props directly to the control component instead of only the parent container
- existing variants first when they already express the requested visual treatment
- avoid over-nesting block groups
- `Repeater(...)` only for dynamic or generated collections, with rows built via `@Each(...)`
- `@Filter(...)` and `@Count(...)` built-ins for derived filtered collections and counts
- local `$variables` for ephemeral UI state such as draft inputs, filters, and internal screen flow
- local arrays for runtime-only collections such as selected answers, and `Query("read_state", ...)` for persisted collections
- `Query("read_state", ...)` with a sensible default when reading persisted data
- `Mutation(...)` with `write_state`, `merge_state`, `append_state`, or `remove_state` for exportable persistent data
- `@Run(queryRef)` after a mutation when a rendered query result needs an immediate refresh
- stable string ids as the first argument of every `Button(...)`

Do not use:

- markdown code fences around generated OpenUI source
- `Screen(..., null, ...)` for the required title argument
- persisted tools for internal screen navigation
- raw CSS, `style`, `className`, named colors, `rgb()`, `hsl()`, `var()`, `url()`, or arbitrary layout styling props
- invented filtering tools or todo-specific filter APIs when built-in functions already cover the request
- hardcoded repeated answer rows or card rows when the prompt asks for dynamic list data
- unresolved `@Run(ref)` calls or any other undefined identifiers

## Required generated app coverage

Generated app behaviors that should stay supported:

- text input
- textarea, select, radio group, or checkbox when the prompt calls for longer input or choices
- buttons with `Action([...])`
- collection rendering via `Repeater`
- dynamic collection rows derived from state, query data, or local arrays instead of hardcoded duplicate content
- derived collection filtering and counts via `@Filter(...)` and `@Count(...)`
- local state via `$variables`
- conditional rendering and/or multi-screen switching

Builder controls that should stay working alongside generated apps:

- import/export
- standalone HTML export
- successful JSON export and standalone HTML export append success messages to the end of chat history instead of showing a top feedback banner
- invalid import should show Definition validation issues without replacing the current preview or wiping chat, undo/redo history, runtime state, or persisted data
- undo/redo
- reset

## Acceptance criteria

- QA docs exist in `docs/qa/`.
- `README.md` links to the QA docs.
- The docs reflect the current API, runtime, and prompt/component contract.
