# Frontend

This workspace contains the builder UI for Kitto JSON Render.

It is a React 19 + TypeScript + Vite application that lets you describe an app in chat, stream JSON Render patches from the backend, and inspect the result in both preview and raw JSON form.

## Local Development

From the repo root:

```bash
npm run dev
```

From this workspace only:

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

Default frontend ports:

- dev server: [http://localhost:5556](http://localhost:5556)
- preview server: [http://localhost:5556](http://localhost:5556)

## Backend Connection

The frontend talks to the backend through:

- `GET /api/config`
- `GET /api/health`
- `POST /api/llm/generate`
- `POST /api/llm/generate/stream`

During development, Vite proxies `/api/*` to the backend target.

Frontend env is intentionally limited to API addressing only:

```env
VITE_API_BASE_URL=/api
VITE_DEV_API_TARGET=http://localhost:8787
```

If you want to point the frontend at a remote backend, set:

```env
VITE_API_BASE_URL=https://your-backend.example.com/api
```

## App Routes

- `/` redirects to `/chat`
- `/chat` is the main builder page
- `/catalog` shows the supported components and actions

## Main Features

- chat-driven builder with streaming responses
- runtime-config bootstrap from `/api/config`
- live preview and definition tabs
- auto-scroll to the newest chat message
- import/export of JSON definitions
- polling `/api/health` every 30 seconds
- backend compaction notices surfaced in the chat UI
- undo/redo capped to 10 snapshots
- persisted builder/runtime state via `redux-remember`
- guarded `open_url` actions that only allow `http` and `https`

## Important Source Areas

- `src/pages/Chat/Chat.tsx`: top-level builder page orchestration
- `src/features/builder/components/ChatPanel.tsx`: chat UI, import/export controls, composer
- `src/features/builder/components/PreviewTabs.tsx`: preview and definition panels
- `src/features/builder/jsonui/`: catalog, registry, runtime wiring
- `src/api/apiSlice.ts`: RTK Query endpoints
- `src/router/router.tsx`: route definitions
- `src/store/store.ts`: Redux store and persistence setup

## Build Notes

- `npm run build` runs `tsc -b && vite build`
- the built assets are emitted to `frontend/dist`
- the backend serves `frontend/dist` in production
