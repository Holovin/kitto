# Backend

This package exposes a small Hono API for the Kitto builder frontend. It serves health information and generates OpenUI source through the OpenAI Responses API.

## Scripts

- `npm run dev --workspace backend` — start the backend with `tsx watch`
- `npm run lint --workspace backend` — TypeScript type-check only
- `npm run build --workspace backend` — compile to `backend/dist`
- `npm run start --workspace backend` — run the compiled server

## Environment

Copy the example file first:

```bash
cp backend/.env.example backend/.env
```

### Required

- `OPENAI_API_KEY` — OpenAI API key used for generation

### Common settings

- `OPENAI_MODEL` — model name for Responses API, default `gpt-5.4-mini`
- `OPENAI_REQUEST_TIMEOUT_MS` — upstream OpenAI timeout in milliseconds
- `PORT` — backend port, default `8787`
- `FRONTEND_ORIGIN` — allowed browser origin for CORS
- `LOG_LEVEL` — backend log level

### LLM safeguards

- `LLM_PROMPT_MAX_CHARS`
- `LLM_CHAT_HISTORY_MAX_ITEMS`
- `LLM_REQUEST_MAX_BYTES`
- `LLM_RATE_LIMIT_MAX_REQUESTS`
- `LLM_RATE_LIMIT_WINDOW_MS`

These values are parsed and validated in `src/env.ts`.

## API

### `GET /api/health`

Returns backend status, configured model, timestamp, and whether an OpenAI key is configured.

Example response:

```json
{
  "status": "ok",
  "model": "gpt-5.4-mini",
  "timestamp": "2026-04-12T17:00:00.000Z",
  "openaiConfigured": true
}
```

### `GET /api/config`

Returns the frontend-safe runtime config that the browser loads at startup.

Example response:

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

Generates the full OpenUI source in one response.

Request shape:

```json
{
  "prompt": "Build a todo list",
  "currentSource": "",
  "chatHistory": [
    { "role": "user", "content": "Build a todo list" }
  ]
}
```

### `POST /api/llm/generate/stream`

Streams partial source over Server-Sent Events.

Event types:

- `chunk` — partial source delta
- `done` — final JSON payload with `model` and `source`
- `error` — terminal error message

## Notes

- The backend only exposes `/api/*` routes. Root-level `/health` and `/llm/*` are not part of the supported API anymore.
- Request size and prompt limits are enforced before the OpenAI call.
- `LLM_CHAT_HISTORY_MAX_ITEMS` controls the recent chat window sent to OpenAI, and the backend may compact older chat messages further when the request body would otherwise exceed `LLM_REQUEST_MAX_BYTES`.
- Streaming requests abort the upstream OpenAI stream when the browser disconnects.
- Rate limiting is in-memory and process-local, which is appropriate for this local project setup.
