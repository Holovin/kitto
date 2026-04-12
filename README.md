# Kitto JSON Render

Kitto JSON Render is a full-stack playground for generating and previewing `@json-render` specs from natural-language prompts.

The app has two main parts:

- `frontend/`: React 19 + Vite builder UI with chat, live preview, definition inspector, import/export, and demo presets
- `backend/`: Hono + OpenAI streaming API that turns prompts into JSON Render patch streams

## What the app does

- `/` redirects to `/chat`
- `/chat` shows the builder UI
- `/catalog` shows the available catalog components and actions
- the frontend streams JSON patch lines from the backend and updates the preview live
- the frontend loads `/api/config` at startup and polls `/api/health` every 30 seconds
- undo/redo history is capped at 10 snapshots
- generated `open_url` actions only allow `http` and `https` URLs
- backend LLM endpoints are rate-limited and normalized before requests reach OpenAI

## Requirements

- Node.js 20+
- npm 10+
- an OpenAI API key

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create the backend env file:

```bash
cp backend/.env.example backend/.env
```

3. Set `OPENAI_API_KEY` in `backend/.env`

4. Start frontend and backend together:

```bash
npm run dev
```

5. Open:

- frontend: [http://localhost:5556](http://localhost:5556)
- chat builder: [http://localhost:5556/chat](http://localhost:5556/chat)
- catalog: [http://localhost:5556/catalog](http://localhost:5556/catalog)
- backend health: [http://localhost:8787/api/health](http://localhost:8787/api/health)
- backend config: [http://localhost:8787/api/config](http://localhost:8787/api/config)

## Workspace Scripts

From the repo root:

```bash
npm run dev
npm run build
npm run start
npm run lint
```

What they do:

- `npm run dev`: starts frontend and backend in parallel
- `npm run build`: builds both workspaces
- `npm run start`: starts the built backend server
- `npm run lint`: runs frontend ESLint and backend TypeScript checks

## Environment

Frontend configuration lives in `frontend/.env.example`:

```env
VITE_API_BASE_URL=/api
VITE_DEV_API_TARGET=http://localhost:8787
```

Backend configuration lives in `backend/.env.example`:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REQUEST_TIMEOUT_MS=120000
FRONTEND_ORIGIN=http://localhost:5556
LLM_PROMPT_MAX_CHARS=4096
LLM_CHAT_HISTORY_MAX_ITEMS=40
LLM_REQUEST_MAX_BYTES=300000
LLM_RATE_LIMIT_WINDOW_MS=60000
LLM_RATE_LIMIT_MAX_REQUESTS=60
PORT=8787
LOG_LEVEL=info
```

Notes:

- `FRONTEND_ORIGIN` must match the frontend origin for CORS
- `OPENAI_REQUEST_TIMEOUT_MS` controls the backend timeout for OpenAI requests
- `LLM_PROMPT_MAX_CHARS`, `LLM_CHAT_HISTORY_MAX_ITEMS`, and `LLM_REQUEST_MAX_BYTES` define the backend normalization and compaction limits
- `LLM_RATE_LIMIT_WINDOW_MS` and `LLM_RATE_LIMIT_MAX_REQUESTS` control the in-memory rate limiter on `/api/llm/*`
- by default the backend listens on port `8787`

## API Surface

The backend exposes:

- `GET /api/health`
- `GET /api/config`
- `POST /api/llm/generate`
- `POST /api/llm/generate/stream`

`/api/llm/generate/stream` aborts the upstream OpenAI stream if the client disconnects.

`GET /api/config` returns the frontend-safe runtime config:

```json
{
  "limits": {
    "promptMaxChars": 4096,
    "chatHistoryMaxItems": 40,
    "requestMaxBytes": 300000
  }
}
```

## Production Notes

- `npm run build` produces `frontend/dist` and `backend/dist`
- when `frontend/dist` exists, the backend serves the built frontend and uses a cached `index.html` for SPA fallback
- in development, Vite proxies `/api/*` to the backend
