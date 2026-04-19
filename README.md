# Kitto OpenUI

Kitto OpenUI is a local-first playground for generating small browser apps from chat prompts. The workspace combines a React/Vite builder, an OpenUI preview runtime, and a Hono backend that calls the OpenAI Responses API and streams generated source back to the browser.

## What the project does today

- chat-driven app generation with streaming updates
- a single automatic repair pass when the first model draft is invalid OpenUI
- live preview from the last committed valid source, a raw definition panel that can show the incoming draft, and an app-state inspector for reactive and persisted data
- undo/redo, reset, JSON import/export with validation-before-apply, and local persistence for committed source, live app state, and builder history
- a `/elements` route for browsing supported OpenUI components, actions, demos, and schemas

## Workspace layout

- `frontend/` - React 19 + Vite 8 builder UI and OpenUI runtime
- `backend/` - Hono API, OpenAI integration, rate limiting, and static hosting for `frontend/dist`

## Requirements

- Node.js 22+
- npm 10+
- `OPENAI_API_KEY`

## Quick start

1. Install workspace dependencies:

   ```bash
   npm install
   ```

2. Create the backend env file:

   ```bash
   cp backend/.env.example backend/.env
   ```

3. Set `OPENAI_API_KEY` in `backend/.env`.

4. Optionally create a frontend env file if you want to override the API base URL or dev proxy target:

   ```bash
   cp frontend/.env.example frontend/.env
   ```

5. Start both apps:

   ```bash
   npm run dev
   ```

6. Open the builder at [http://localhost:5555](http://localhost:5555).

By default:

- the frontend runs on `http://localhost:5555`
- the backend runs on `http://localhost:8787`
- Vite proxies `/api/*` from the frontend to the backend

## Root scripts

- `npm run dev` - runs frontend and backend together
- `npm run lint` - runs frontend ESLint and backend TypeScript checks
- `npm run test` - runs frontend and backend unit tests without calling the real OpenAI service
- `npm run test:frontend` - runs frontend Vitest coverage for validation, reducers, import/export helpers, and stream parsing
- `npm run test:backend` - runs backend Vitest coverage for `/api/*` contracts, request validation, and prompt drift guards
- `npm run build` - builds the frontend bundle and the backend server
- `npm run start` - starts the compiled backend

## Development and production flow

In development, the frontend talks to `/api/*` and Vite proxies that traffic to the backend target from `VITE_DEV_API_TARGET`. If that variable is not set, the Vite config falls back to `http://localhost:<PORT>` using `backend/.env`.

After `npm run build`, `npm run start` launches the compiled backend on `PORT` and serves the built frontend routes from `frontend/dist` when that folder exists. That means the built app can run as a single server process. If `frontend/dist` is missing, the backend still serves the API only.

## Environment

### Frontend

Frontend env is optional.

- `VITE_API_BASE_URL` - backend base URL used by the browser, default `/api`
- `VITE_DEV_API_TARGET` - dev proxy target used by Vite, default `http://localhost:8787`

### Backend

- `OPENAI_API_KEY` - required API key for generation
- `OPENAI_MODEL` - Responses API model, default `gpt-5.4-mini`
- `OPENAI_REQUEST_TIMEOUT_MS` - upstream OpenAI timeout, default `120000`
- `FRONTEND_ORIGIN` - allowed browser origin for CORS, default `http://localhost:5555`
- `PORT` - backend port, default `8787`
- `LOG_LEVEL` - one of `debug`, `info`, `warn`, `error`, `silent`
- `LLM_PROMPT_MAX_CHARS` - prompt length limit, default `4096`
- `LLM_CHAT_HISTORY_MAX_ITEMS` - chat window sent to the backend, default `40`
- `LLM_REQUEST_MAX_BYTES` - safe compacted request size, default `300000`
- `LLM_RATE_LIMIT_MAX_REQUESTS` - in-memory request cap per window, default `60`
- `LLM_RATE_LIMIT_WINDOW_MS` - rate-limit window, default `60000`

## API surface

The supported API lives under `/api/*` only.

- `GET /api/health` - backend status, configured model, timestamp, and OpenAI key presence
- `GET /api/config` - frontend-safe request limits loaded at bootstrap
- `POST /api/llm/generate` - non-streaming OpenUI generation
- `POST /api/llm/generate/stream` - SSE stream with `chunk`, `done`, and `error` events

## Builder capabilities

### Main routes

- `/` and `/chat` - chat builder, preview, definition panel, app-state inspector, import/export, undo/redo, reset, and auto-repair flow
- `/elements` - schema explorer for the supported OpenUI surface

### Supported OpenUI components

`AppShell`, `Screen`, `Group`, `Repeater`, `Text`, `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, `Link`

### Built-in actions in the sandbox

`read_state`, `write_state`, `merge_state`, `append_state`, `remove_state`

Internal screen changes should use local OpenUI state such as `$currentScreen` with `@Set(...)` instead of persisted tools.
Persisted tool paths must be non-empty dot-paths up to 10 segments deep, use only letters, numbers, `_`, or `-`, and must never include `__proto__`, `prototype`, or `constructor`. `remove_state` also requires an explicit non-negative integer `index`.

## Runtime safeguards

- prompt, chat-history, and request-size validation before the OpenAI call
- request compaction when chat history exceeds the configured item or byte limits
- in-memory rate limiting on LLM routes
- OpenAI request timeouts
- a single automatic repair retry that includes the original request, committed valid source, invalid draft, validation issues, and critical syntax rules
- Preview stays on the last committed valid app while streaming, validation, and automatic repair run against the incoming draft
- imported definition files are validated before they replace the current committed preview
- invalid imports stay visible in Definition as rejected drafts with parse issues, without wiping chat history or the current runtime/domain snapshot
- reload restores the last committed source, current reactive state, persisted domain data, and undo/redo history from local persistence
- automatic fallback from streaming to non-streaming generation when the stream fails before the first chunk
- a streaming response counts as successful only after a valid terminal `done` event; truncated or aborted streams never commit partial drafts
- request-scoped generation prevents stale stream or fallback responses from overwriting a newer request, and intentional aborts never commit partial drafts
- `Link(...)` and `@OpenUrl(...)` share a safe URL policy: only `https:`, `http:`, `mailto:`, `tel:`, app-relative `/...`, and hash `#...` links are allowed; blocked or malformed URLs are rendered inert or ignored
- upstream stream cancellation when the browser disconnects

## QA doc maintenance

When you change QA-visible behavior, update the QA docs in the same change if they stop matching. This includes API routes, prompt/component signatures, supported tools, builder controls such as import/export or undo/redo, and manual smoke-test steps or expectations.

## Additional docs

- [docs/qa/openui-agent-smoke.md](docs/qa/openui-agent-smoke.md)
- [docs/qa/openui-manual-checklist.md](docs/qa/openui-manual-checklist.md)
- [frontend/README.md](frontend/README.md)
- [backend/README.md](backend/README.md)
