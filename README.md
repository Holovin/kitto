# Kitto OpenUI

Kitto OpenUI is a local-first playground for generating small browser apps from chat prompts. It combines a React/Vite builder, a constrained OpenUI runtime, and a Hono backend that calls the OpenAI Responses API to generate or update OpenUI source.

## 1. Overview

- Generate small browser apps from chat prompts and follow-up edits.
- Stream draft OpenUI into the Definition panel while keeping Preview on the last committed valid app.
- Support undo/redo, reset, versioned JSON import/export, standalone HTML export, and persisted runtime/domain state.
- Include an `/elements` route for inspecting the supported OpenUI component and tool surface.

## 2. Quick start

Requirements:

- Node.js 22+
- npm 10+
- `OPENAI_API_KEY`

```bash
npm install
cp backend/.env.example backend/.env
# set OPENAI_API_KEY in backend/.env
npm run dev
npm run test
npm run build
npm run start
```

Notes:

- `npm run dev` starts the frontend and backend together and also watches/rebuilds the standalone player asset bundle used by `Download standalone HTML`.
- In development, the builder is available at [http://localhost:5555](http://localhost:5555) and the backend runs at `http://localhost:8787`.
- In development, the frontend talks to `/api/*` and Vite proxies those requests to the backend.
- `npm run start` launches the compiled backend after `npm run build` and serves the built frontend when `frontend/dist` exists.
- `npm run build` also rebuilds the standalone player assets embedded into exported `.html` files.
- If you want to override the API base URL or dev proxy target, copy `frontend/.env.example` to `frontend/.env`.

## 3. Architecture note

- `frontend/` is a React 19 + Vite 8 builder UI for chat, Definition, Preview, `/elements`, and state inspection.
- State is managed with Redux Toolkit and persisted with `redux-remember`.
- The OpenUI runtime renders a constrained component/action/tool surface in the browser.
- The frontend OpenUI library is the source of truth, and `shared/openui-component-spec.json` is a generated artifact consumed by the backend prompt.
- `backend/` is a Hono service that proxies generation requests to the OpenAI Responses API.
- Generation follows a validation, single-repair, and commit pipeline.
- Preview renders committed source only.

## 4. AI usage note

- The LLM is used only to generate or update OpenUI source from chat requests.
- Internal preview interactions such as screen changes, form edits, and button clicks run locally; only chat submissions hit `/api/llm/*`.
- Generated apps run in the browser on top of the OpenUI runtime and persisted browser state.
- The frontend validates generated drafts locally and triggers at most one repair pass before commit.
- `OPENAI_API_KEY` stays on the backend; the browser does not receive it.

## 5. Standalone HTML export

- `Download standalone HTML` creates one self-contained `.html` file from the current committed OpenUI app.
- The file embeds a minimal OpenUI player runtime, the committed source, and the committed snapshot baseline runtime/domain state.
- The generated HTML stores its embedded app payload in an inert `<script type="application/json">` block before the inline player bundle; it does not rely on a `window` payload global.
- The exported app opens without the Kitto builder shell, backend, OpenAI configuration, or `/api/*` requests.
- Standalone apps persist their own runtime and domain data in localStorage under a per-app storage key and can reset back to the embedded baseline state.
- When a standalone export is opened from `file://`, root-relative app paths such as `/chat` and hash/self links such as `#details` are intentionally treated as invalid and rendered inert because there is no builder router or stable hosted origin behind the file.
- The export includes only the standalone app definition payload and does not include chat history, undo/redo or builder version history, rejected drafts, or React source code.

## 6. Trade-offs / scope

- There is no arbitrary JavaScript or general code mode; generated output is constrained to the supported OpenUI surface.
- The project does not generate npm packages, full codebases, or general-purpose app scaffolding.
- The supported OpenUI component and tool surface is intentionally small.
- Rate limiting is in-memory and demo-grade rather than distributed production infrastructure.
- Generated apps are browser-first and do not require a generated backend.

## 7. Supported surface

### Main routes

- `/` and `/chat` for the chat builder, Definition, Preview, import/export, undo/redo, reset, and app-state inspection
- `/` and `/chat` also expose standalone HTML export for the current committed app
- `/elements` for browsing the supported OpenUI components, actions, demos, and schemas

### Supported OpenUI components

`AppShell`, `Screen`, `Group`, `Repeater`, `Text`, `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, `Link`

### Persisted tools exposed through `Query(...)` and `Mutation(...)`

`read_state`, `write_state`, `merge_state`, `append_state`, `remove_state`

Notes:

- `Group(title, direction, children, variant?)` supports `block` and `inline`. `block` is the default card-like section surface; `inline` is the lightweight nested layout for inline controls, repeated rows, and groups inside an existing block.
- Internal screen flow uses local runtime state such as `$currentScreen` with `@Set(...)`, not persisted tools.
- `@OpenUrl(...)` is a built-in OpenUI action event and shares the same safe URL policy as `Link(...)`.
- Persisted tool paths must be non-empty dot-paths up to 10 segments deep and reject `__proto__`, `prototype`, and `constructor`.
- Import/export uses a versioned JSON format and validates before apply; invalid imports stay in Definition and do not replace the current committed preview.
- Standalone HTML export always uses the latest committed source and the committed snapshot baseline state, not the current live clicked state.

## 8. API surface

The supported backend API lives under `/api/*` only.

- `GET /api/health` returns backend status, configured model, timestamp, and OpenAI key presence.
- `GET /api/config` returns frontend-safe request limits and stream timeout policy.
- `POST /api/llm/generate` performs non-streaming OpenUI generation.
- `POST /api/llm/generate/stream` streams `chunk`, `done`, and `error` SSE events.

## 9. Additional docs

- [docs/qa/openui-agent-smoke.md](docs/qa/openui-agent-smoke.md)
- [docs/qa/openui-manual-checklist.md](docs/qa/openui-manual-checklist.md)
- [frontend/README.md](frontend/README.md)
- [backend/README.md](backend/README.md)
