# Kitto OpenUI

Kitto OpenUI is a local-first playground for generating small browser apps from chat prompts. It combines a React/Vite builder, a constrained OpenUI runtime, and a Hono backend that calls the OpenAI Responses API to generate or update OpenUI source.

## 1. Overview

- Generate small browser apps from chat prompts and follow-up edits.
- Stream draft model output into the Definition panel while keeping Preview on the last committed valid app.
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
# for local dev, set PORT=8787, FRONTEND_ORIGIN=http://localhost:5555, and PROMPT_IO_LOG=true if you want prompt I/O JSONL logs
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
- `backend/.env.example` is production-oriented for PM2 deployment. For local development, set `PORT=8787` and `FRONTEND_ORIGIN=http://localhost:5555` in `backend/.env` after copying it.
- Set `PROMPT_IO_LOG=true` in `backend/.env` (or prefix `npm run dev` with it) when you want append-only prompt/model logs in `backend/logs/prompt-io.jsonl` for prompt tuning. The default is `false`.
- If you want to override the API base URL or dev proxy target, copy `frontend/.env.example` to `frontend/.env`.

## 3. Production deployment

- One compiled Node process serves both the frontend routes and `/api/*`.
- The supported production path is `npm run build`, then `pm2 start ecosystem.config.cjs --env production`.
- Keep PM2 running from the repo root so the backend can resolve `frontend/dist`. The backend loads `backend/.env` relative to its own package, so the PM2 working directory does not need to be the `backend/` folder.
- See [docs/deploy.md](docs/deploy.md) for the full VPS and Nginx Proxy Manager flow.

## 4. Architecture note

- `frontend/` is a React 19 + Vite 8 builder UI for chat, Definition, Preview, `/elements`, and state inspection.
- State is managed with Redux Toolkit and persisted with `redux-remember`.
- The OpenUI runtime renders a constrained component/action/tool surface in the browser.
- The frontend OpenUI library is the source of truth, and `shared/openui-component-spec.json` is a generated artifact consumed by the backend prompt.
- The production SPA fallback route allowlist lives in `shared/frontend-routes.json`. Keep it aligned with `frontend/src/router/siteRoutes.ts`; backend fallback tests and frontend route contract tests both depend on it.
- `backend/` is a Hono service that proxies generation requests to the OpenAI Responses API.
- Generation follows a validation, configurable automatic-repair, and commit pipeline.
- The backend owns all model-visible prompt assembly for both initial generation and repair flows; the frontend sends raw builder inputs only.
- Preview renders committed source only.

## 5. AI usage note

- The LLM is used only to generate or update OpenUI source from chat requests.
- By default, the backend requests a structured model envelope shaped like `{"summary":"...","source":"..."}` from the OpenAI Responses API.
- The backend response payload is a separate JSON shape: `{"source":"...","model":"...","summary":"...","summaryExcludeFromLlmContext"?:true,"qualityIssues":[...],"compaction"?:{...}}`.
- Internal preview interactions such as screen changes, form edits, and button clicks run locally; chat submissions hit the generation endpoints, and the client also sends fire-and-forget commit telemetry to `/api/llm/commit-telemetry` after validation or commit outcomes for real generation responses.
- Generated apps run in the browser on top of the OpenUI runtime and persisted browser state.
- The frontend validates generated drafts locally and triggers up to the configured repair limit before commit (default: 2 attempts).
- During streaming, `chunk` events carry incremental model-envelope text, the frontend derives partial `summary` / `source` from that stream, and commit still happens only from the final backend `done` payload plus its extracted `source`, `qualityIssues`, and optional `summaryExcludeFromLlmContext`.
- If generation fails, the builder keeps the last committed preview and enables `Repeat` in an empty composer to resend the last failed prompt; typing a new prompt switches that action back to `Send`.
- `OPENAI_API_KEY` stays on the backend; the browser does not receive it.
- Prompt I/O logging is local-only, append-only, and disabled by default. When enabled, the backend writes model inputs/outputs to `backend/logs/prompt-io.jsonl`.

## 6. Standalone HTML export

- `Download standalone HTML` creates one self-contained `.html` file from the current committed OpenUI app.
- The file embeds a minimal OpenUI player runtime, the committed source, and the committed snapshot baseline runtime/domain state.
- The generated HTML stores its embedded app payload in an inert `<script type="application/json">` block before the inline player bundle; it does not rely on a `window` payload global.
- The exported app opens without the Kitto builder shell, backend, OpenAI configuration, or `/api/*` requests.
- Standalone apps persist their own runtime and domain data in localStorage under a per-app storage key and can reset back to the embedded baseline state.
- When a standalone export is opened from `file://`, root-relative app paths such as `/chat` and hash/self links such as `#details` are intentionally treated as invalid and rendered inert because there is no builder router or stable hosted origin behind the file.
- The export includes only the standalone app definition payload and does not include chat history, undo/redo or builder version history, rejected drafts, or React source code.

## 7. Trade-offs / scope

- The project does not include user accounts, authentication, or per-user authorization; hosted deployments should be treated as controlled demo playgrounds.
- There is no arbitrary JavaScript or general code mode; generated output is constrained to the supported OpenUI surface.
- The project does not generate npm packages, full codebases, or general-purpose app scaffolding.
- The supported OpenUI component and tool surface is intentionally small.
- Generation rate limiting uses one shared in-memory bucket per Node process. This is intentional for the no-auth demo scope and is meant to cap demo traffic rather than isolate individual users.
- Generated apps are browser-first and do not require a generated backend.

## 8. Supported surface

### Main routes

- `/` and `/chat` for the chat builder, Definition, Preview, import/export, undo/redo, reset, and app-state inspection
- `/` and `/chat` also expose standalone HTML export for the current committed app
- `/elements` for browsing the supported OpenUI components, actions, demos, and schemas

### Supported OpenUI components

`AppShell`, `Screen`, `Group`, `Repeater`, `Text`, `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, `Link`

### Supported tools exposed through `Query(...)` and `Mutation(...)`

`read_state`, `compute_value`, `write_state`, `merge_state`, `append_state`, `append_item`, `toggle_item_field`, `update_item_field`, `remove_item`, `remove_state`, `write_computed_state`

`remove_state` requires a strict non-negative integer `index`.

Notes:

- `AppShell(children, appearance?)` can set the global inherited theme with `appearance.mainColor` and `appearance.contrastColor`.
- `Screen(id, title, children, isActive?, appearance?)`, `Group(title, direction, children, variant?, appearance?)`, and `Repeater(children, emptyText?, appearance?)` can override the inherited theme for a subtree.
- `appearance.mainColor` is the main surface/background color, and `appearance.contrastColor` is the contrasting text/action color.
- `Text(value, variant?, align?, appearance?)` accepts only `appearance.contrastColor`. `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, and `Link` accept both `appearance.mainColor` and `appearance.contrastColor`.
- `Checkbox` supports both local form bindings and explicit action-mode toggles: use a writable `$binding<boolean>` for form state, or a display-only boolean plus `Action([...])` for persisted row updates.
- For any `Button(..., variant, ..., appearance)`, `appearance.mainColor` sets the button background and `appearance.contrastColor` sets the button text. Variants differ only by fallback styling when no `appearance` is provided.
- Use one shared parent `appearance` for app-wide theme changes; children inherit those colors automatically unless they set a local override.
- Use existing variants first when they are enough; do not generate raw CSS, `style`, `className`, named colors, `rgb()`, `hsl()`, `var()`, or layout styling props.
- Internal screen flow uses local runtime state such as `$currentScreen` with `@Set(...)`, not persisted tools.
- `@OpenUrl(...)` is a built-in OpenUI action event and shares the same safe URL policy as `Link(...)`.
- Prefer built-ins such as `@Each`, `@Filter`, `@Count`, equality checks, boolean expressions, ternaries, and property access before using the generic compute tools.
- Collection filtering should use `@Filter(collection, field, operator, value)` with operators `==`, `!=`, `>`, `<`, `>=`, `<=`, or `contains`; use `contains` for substring search, not predicate-style callbacks or `includes`.
- Keep ephemeral filter selection in local `$variables` such as `$filter`; switching filters should stay local and must not hit `/api/llm/*`.
- For persisted collections of object rows, prefer `append_item` so new rows get a unique stable `id` automatically.
- Plain `Checkbox(item.completed)` stays display-only; add an explicit `Action([...])` when the checkbox itself should persist a row toggle.
- Use `toggle_item_field`, `update_item_field`, and `remove_item` for id-based row actions, and relay `item.id` through local state before `@Run(...)`.
- `compute_value` and `write_computed_state` both return `{ value }`, where `value` is always a primitive string, number, or boolean.
- `write_computed_state` computes a safe primitive and writes it into persisted state at the validated path.
- Persisted tool paths must be non-empty dot-paths up to 10 segments deep and reject `__proto__`, `prototype`, and `constructor`.
- Import/export uses a versioned JSON format and validates before apply; invalid imports stay in Definition and do not replace the current committed preview.
- Standalone HTML export always uses the latest committed source and the committed snapshot baseline state, not the current live clicked state.

## 9. API surface

The supported backend API lives under `/api/*` only.

- `GET /api/health` returns backend status, configured model, timestamp, and OpenAI key presence.
- `GET /api/config` returns frontend-safe generation temperatures, request limits, stream timeout policy, and repair-attempt policy.
- `POST /api/llm/generate` performs non-streaming OpenUI generation.
- `POST /api/llm/generate/stream` streams `chunk`, `done`, and `error` SSE events. `chunk` can contain raw structured JSON draft text, while `done.source` carries the extracted OpenUI source used for commit.
- `POST /api/llm/commit-telemetry` records client-side validation, soft quality warnings, and commit outcomes for a completed generation request without blocking the UI, rejecting unmatched, header/body-mismatched, or overused request ids.

## 10. Additional docs

- [docs/deploy.md](docs/deploy.md)
- [docs/qa/openui-agent-smoke.md](docs/qa/openui-agent-smoke.md)
- [docs/qa/openui-manual-checklist.md](docs/qa/openui-manual-checklist.md)
- [frontend/README.md](frontend/README.md)
- [backend/README.md](backend/README.md)
