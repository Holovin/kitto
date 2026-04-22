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
- `OPENAI_REQUEST_TIMEOUT_MS` - upstream timeout in milliseconds, default `120000`
- `PORT` - HTTP port, default `8787`
- `FRONTEND_ORIGIN` - allowed browser origin for CORS, default `http://localhost:5555`
- `LOG_LEVEL` - `debug`, `info`, `warn`, `error`, or `silent`

The backend loads `backend/.env` relative to its own package path, so PM2 can keep `cwd` at the repo root without losing the env file.

### Request limits and safeguards

- `LLM_PROMPT_MAX_CHARS` - default `4096`
- `LLM_CHAT_HISTORY_MAX_ITEMS` - default `40`
- `LLM_REQUEST_MAX_BYTES` - default `300000`
- `LLM_OUTPUT_MAX_BYTES` - default `100000`
- `LLM_RATE_LIMIT_MAX_REQUESTS` - default `60`
- `LLM_RATE_LIMIT_WINDOW_MS` - default `60000`

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
    "promptMaxChars": 4096,
    "chatHistoryMaxItems": 40,
    "requestMaxBytes": 300000
  }
}
```

### `POST /api/llm/generate`

Accepts:

```json
{
  "prompt": "Build a todo list",
  "currentSource": "",
  "chatHistory": [
    { "role": "user", "content": "Build a todo list" }
  ]
}
```

The model first returns a structured envelope shaped like:

```json
{
  "summary": "Builds a todo app.",
  "source": "root = AppShell([])"
}
```

The backend then returns a response payload shaped like:

```json
{
  "source": "root = AppShell([])",
  "model": "gpt-5.4-mini",
  "summary": "Builds a todo app.",
  "compaction": {
    "compactedByBytes": false,
    "compactedByItemLimit": true,
    "omittedChatMessages": 2
  }
}
```

`summary` is always present.

### `POST /api/llm/generate/stream`

Accepts the same request shape and streams Server-Sent Events:

- `chunk` - incremental raw model text; with structured output enabled this is a partial model envelope carrying `summary` / `source`
- `done` - final backend response payload with `source`, `model`, `summary`, and optional `compaction`
- `error` - terminal public error payload

## Current behavior

- rejects oversized raw request bodies before JSON parsing with Hono body-limit middleware
- rejects model output that exceeds `LLM_OUTPUT_MAX_BYTES` before returning JSON or completing an SSE response
- compacts chat history when item or byte limits are exceeded
- rate-limits LLM endpoints with in-memory middleware
- cancels the upstream OpenAI request when the client disconnects
- returns public validation, timeout, upstream, and internal error payloads
- serves `frontend/dist/index.html` for the frontend entry routes when the frontend build exists

## Notes

- after `npm run build`, one Node process can serve both `frontend/dist` and `/api/*`
- use the repo-root [ecosystem.config.cjs](../ecosystem.config.cjs) with `instances: 1` and `exec_mode: "fork"` for PM2 deployments; multiple instances change the in-memory rate-limit behavior
- keep the PM2 `cwd` at the repo root so the compiled backend can resolve `frontend/dist`
- rate limiting is process-local and meant for single-process deployment, not distributed deployment
