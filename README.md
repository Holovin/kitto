# Kitto OpenUI

Kitto OpenUI is a local-first playground for generating small browser apps from chat prompts. The repository is split into a React/Vite frontend and a Hono backend that proxies requests to the OpenAI Responses API and streams OpenUI source back to the builder.

## Workspace layout

- `frontend/` — builder UI, live preview, schema explorer, persistence, and OpenUI runtime.
- `backend/` — Hono API for health checks and OpenAI-backed generation.

## Requirements

- Node.js 22+
- npm 10+
- An OpenAI API key

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Create the backend env file:

```bash
cp backend/.env.example backend/.env
```

3. Set `OPENAI_API_KEY` in `backend/.env`.

4. Optionally create a frontend env file if you want to override defaults:

```bash
cp frontend/.env.example frontend/.env
```

5. Start frontend and backend together:

```bash
npm run dev
```

- Frontend dev server: `http://localhost:5555`
- Backend API: `http://localhost:8787/api` by default

## Root scripts

- `npm run dev` — runs frontend and backend in parallel
- `npm run lint` — runs frontend ESLint and backend TypeScript checks
- `npm run build` — builds frontend and backend
- `npm run start` — starts the built backend

## API routing

The app now uses `/api/*` endpoints only.

- `GET /api/health`
- `POST /api/llm/generate`
- `POST /api/llm/generate/stream`

In development, Vite proxies `/api/*` to the backend. If you deploy the frontend separately, point `VITE_API_BASE_URL` at the backend base path.

## Runtime safeguards

The backend is intended for local use, but it still enforces basic request controls:

- configurable request size limits
- configurable prompt and chat-history limits
- configurable in-memory rate limiting for LLM endpoints
- OpenAI request timeouts
- stream cancellation when the browser disconnects

Frontend request guards load the public prompt and chat-window limits from `/api/config` for faster feedback, but the backend remains authoritative.

## Documentation

- `frontend/README.md`
- `backend/README.md`
