# Backend

This package exposes the Kitto API and OpenAI integration. It serves health and runtime-config endpoints, generates OpenUI source through the OpenAI Responses API, streams partial output over SSE, and serves the built frontend when `frontend/dist` is available.

## Scripts

- `npm run dev --workspace backend` - start the backend with `tsx watch`
- `npm run lint --workspace backend` - TypeScript type-check only
- `npm run build --workspace backend` - compile to `backend/dist`
- `npm run start --workspace backend` - run the compiled server

## Environment

Create the env file first:

```bash
cp backend/.env.example backend/.env
```

The checked-in example is production-oriented for the PM2 deployment in [docs/deploy.md](../docs/deploy.md). For local development, change `PORT` back to `8787` and `FRONTEND_ORIGIN` back to `http://localhost:5555` after copying it.

### Required

- `OPENAI_API_KEY` - API key used for generation

### Runtime settings

- `OPENAI_MODEL` - Responses API model, default `gpt-5.4-mini`
- `OPENAI_REQUEST_TIMEOUT_MS` - upstream timeout in milliseconds, default `180000`
- `PORT` - HTTP port, default `8787`
- `FRONTEND_ORIGIN` - allowed browser origin for CORS, default `http://localhost:5555`
- `LOG_LEVEL` - `debug`, `info`, `warn`, `error`, or `silent`

The backend loads `backend/.env` relative to its own package path, so PM2 can keep `cwd` at the repo root without losing the env file.

### Request limits and safeguards

- `LLM_USER_PROMPT_MAX_CHARS` - default `4096`, maximum user-authored prompt characters accepted by the API and composer
- `CURRENT_SOURCE_EMERGENCY_MAX_CHARS` - default `80000`, hard source/draft cap before building model prompts
- `LLM_MODEL_PROMPT_MAX_CHARS` - default `180000`, prompt context budget used when dropping optional context
- `LLM_REQUEST_MAX_BYTES` - default `1200000`, compacted generation request budget
- `REQUEST_BODY_LIMIT_BYTES` - default `1200000`, raw `/api/llm/*` HTTP body limit
- `LLM_OUTPUT_MAX_BYTES` - default `300000`, final generated source/output budget
- `LLM_MAX_REPAIR_ATTEMPTS` - default `2`
- `STREAM_IDLE_TIMEOUT_MS` - default `60000`
- `RATE_LIMIT_MAX_REQUESTS` - default `60`
- `RATE_LIMIT_WINDOW_MS` - default `60000`

Environment variables are for deploy/runtime tuning. Fine-grained prompt section caps are intentionally code constants, not env variables, because they are part of the OpenUI generation contract.

These values are parsed and validated in `src/env.ts`. The browser receives the public request limits from `GET /api/config`.

## API

The backend exposes `/api/*` routes only.

### `GET /api/health`

Returns backend status, the configured model, a timestamp, and whether `OPENAI_API_KEY` is present.

### `GET /api/config`

Returns frontend-safe request limits:

```json
{
  "limits": {
    "chatMessageMaxChars": 4096,
    "promptMaxChars": 4096,
    "chatHistoryMaxItems": 5,
    "requestMaxBytes": 1200000,
    "sourceMaxChars": 80000
  }
}
```

`limits.promptMaxChars` and `limits.chatMessageMaxChars` are backed by `LLM_USER_PROMPT_MAX_CHARS`; `limits.sourceMaxChars` is backed by `CURRENT_SOURCE_EMERGENCY_MAX_CHARS`; `limits.chatHistoryMaxItems` is an internal generation contract constant.

### `POST /api/llm/generate`

Accepts:

```json
{
  "prompt": "Build a todo list",
  "currentSource": "",
  "mode": "initial",
  "previousUserMessages": [],
  "previousChangeSummaries": [],
  "appMemory": {
    "version": 1,
    "appSummary": "",
    "userPreferences": [],
    "avoid": []
  }
}
```

The model first returns a structured envelope shaped like:

```json
{
  "summary": "Builds a todo app.",
  "changeSummary": "Created a persisted todo list with add and completion controls.",
  "appMemory": {
    "version": 1,
    "appSummary": "A browser-only todo tracker with persisted tasks, completion toggles, and a compact main-screen task flow.",
    "userPreferences": ["Keep the UI compact."],
    "avoid": []
  },
  "source": "root = AppShell([])"
}
```

The backend then returns a response payload shaped like:

```json
{
  "source": "root = AppShell([])",
  "model": "gpt-5.4-mini",
  "summary": "Builds a todo app.",
  "changeSummary": "Created a persisted todo list with add and completion controls.",
  "appMemory": {
    "version": 1,
    "appSummary": "A browser-only todo tracker with persisted tasks, completion toggles, and a compact main-screen task flow.",
    "userPreferences": ["Keep the UI compact."],
    "avoid": []
  },
  "compaction": {
    "compactedByBytes": false,
    "compactedByItemLimit": true,
    "omittedChatMessages": 2
  }
}
```

`summary`, `changeSummary`, and `appMemory` are always present. `source` remains the authoritative app definition. For normal follow-up generation, the backend sends the full committed `currentSource` while it stays under the hard source cap and rejects larger requests safely instead of substituting inventory-only or currentSourceItems context. The legacy `chatHistory` field is ignored for model context; clients send `previousUserMessages`, `previousChangeSummaries`, optional `historySummary`, and optional `appMemory` instead. `appMemory` is a compact LLM context artifact only, not runtime state or exported preview memory, and it must not duplicate previous change summaries, prompt diagnostics, runtime preview data, or full OpenUI source.

### `POST /api/llm/generate/stream`

Accepts the same request shape and streams Server-Sent Events:

- `chunk` - incremental raw model text; this is a partial model envelope carrying `summary` / `source`
- `done` - final backend response payload with `source`, `model`, `summary`, `changeSummary`, `appMemory`, and optional `compaction`
- `error` - terminal public error payload

## Current behavior

- rejects oversized raw request bodies before JSON parsing with Hono body-limit middleware
- rejects model output that exceeds `LLM_OUTPUT_MAX_BYTES` before returning JSON or completing an SSE response
- compacts derived previous user/change context when item or byte limits are exceeded
- rate-limits LLM endpoints with in-memory middleware
- cancels the upstream OpenAI request when the client disconnects
- returns public validation, timeout, upstream, and internal error payloads
- serves `frontend/dist/index.html` for the frontend entry routes when the frontend build exists

## Notes

- after `npm run build`, one Node process can serve both `frontend/dist` and `/api/*`
- the backend does not implement user authentication or per-user authorization; exposed deployments should be treated as controlled demo environments
- use the repo-root [ecosystem.config.cjs](../ecosystem.config.cjs) with `instances: 1` and `exec_mode: "fork"` for PM2 deployments; multiple instances change the in-memory rate-limit behavior
- keep the PM2 `cwd` at the repo root so the compiled backend can resolve `frontend/dist`
- generation rate limiting is one shared process-local bucket per Node process; that is acceptable for no-auth demo use, but it is not per-user isolation or distributed deployment infrastructure
