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
- the frontend polls `/health` every 30 seconds to detect backend recovery
- undo/redo history is capped at 10 snapshots
- generated `open_url` actions only allow `http` and `https` URLs
- backend LLM endpoints are rate-limited with environment-based limits

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
- backend health: [http://localhost:8787/health](http://localhost:8787/health)

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

Backend configuration lives in `backend/.env.example`:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
FRONTEND_ORIGIN=http://localhost:5556
LLM_RATE_LIMIT_WINDOW_MS=60000
LLM_RATE_LIMIT_MAX_REQUESTS=10
PORT=8787
LOG_LEVEL=info
```

Notes:

- `FRONTEND_ORIGIN` must match the frontend origin for CORS
- `LLM_RATE_LIMIT_WINDOW_MS` and `LLM_RATE_LIMIT_MAX_REQUESTS` control the in-memory rate limiter on `/llm/*`
- by default the backend listens on port `8787`

## API Surface

The backend exposes:

- `GET /health`
- `POST /llm/generate`
- `POST /llm/generate/stream`

`/llm/generate/stream` aborts the upstream OpenAI stream if the client disconnects.

## Production Notes

- `npm run build` produces `frontend/dist` and `backend/dist`
- when `frontend/dist` exists, the backend serves the built frontend and uses a cached `index.html` for SPA fallback
- in development, Vite proxies `/health` and `/llm` to the backend
