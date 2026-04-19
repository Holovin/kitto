# Kitto OpenUI Manual Checklist

## API contract

Supported API:

- `GET /api/health`
- `GET /api/config`
- `POST /api/llm/generate`
- `POST /api/llm/generate/stream`

## Runtime invariants

- Preview renders committed source only.
- Definition may show streamed or rejected draft source.
- Invalid source is never committed to Preview or builder history.
- Invalid import keeps the last committed Preview/runtime/domain state and only surfaces the rejected source in Definition with parse issues.
- Internal preview clicks do not call the LLM; only chat submissions should hit `/api/llm/*`.
- `toolProvider` is only used by `Query(...)` and `Mutation(...)`.
- Allowed tool names are `read_state`, `write_state`, `merge_state`, `append_state`, and `remove_state`.
- `@OpenUrl` is handled through the OpenUI built-in action event bridge, not through persisted tools.
- External URL opens should be limited to `https://...`.
- Screen navigation uses local state such as `$currentScreen` with `@Set(...)`.
- Persisted tools are for exportable/shared domain data, not internal screen navigation.

## Prompt and component contract

Root:

```txt
root = AppShell([...])
```

Button:

```txt
Button(id, label, variant, action?, disabled?)
```

Screen:

```txt
Screen(id, title, children, isActive?)
```

Navigation:

```txt
$currentScreen = "intro"
Button("next-button", "Next", "default", Action([@Set($currentScreen, "next")]), false)
```

Collections:

```txt
Repeater(@Each(items, ...), "Empty state")
```

Do use:

- `Screen(...)` for screen-level sections and `Group(...)` for local layout
- `Repeater(...)` for collections, preferably with `@Each(...)`
- local `$variables` for ephemeral UI state such as draft inputs, filters, and internal screen flow
- `Query("read_state", ...)` with a sensible default when reading persisted data
- `Mutation(...)` with `write_state`, `merge_state`, `append_state`, or `remove_state` for exportable persistent data
- `@Run(queryRef)` after a mutation when a rendered query result needs an immediate refresh
- stable string ids as the first argument of every `Button(...)`

Do not use:

- markdown code fences around generated OpenUI source
- `Screen(..., null, ...)` for the required title argument
- `Mutation("navigate_screen", ...)`
- persisted tools for internal screen navigation
- unresolved `@Run(ref)` calls or any other undefined identifiers

## Required generated app coverage

Generated app behaviors that should stay supported:

- text input
- textarea, select, radio group, or checkbox when the prompt calls for longer input or choices
- buttons with `Action([...])`
- collection rendering via `Repeater`
- local state via `$variables`
- conditional rendering and/or multi-screen switching

Builder controls that should stay working alongside generated apps:

- import/export
- invalid import should show Definition validation issues without replacing the current preview or wiping chat, undo/redo history, runtime state, or persisted data
- undo/redo
- reset

## Acceptance criteria

- QA docs exist in `docs/qa/`.
- `README.md` links to the QA docs.
- The docs reflect the current API, runtime, and prompt/component contract.
