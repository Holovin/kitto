# Frontend

This package contains the Kitto builder UI. It lets you chat with the backend, stream OpenUI source, preview the generated app, inspect the raw definition, and browse supported component schemas.

## Main routes

- `/` and `/chat` — builder experience with chat, preview, import/export, undo/redo, and auto-repair for invalid OpenUI drafts
- `/elements` — schema explorer and live sandbox for supported OpenUI components

## Stack

- React 19
- Vite 8
- Redux Toolkit
- RTK Query
- React Router 7
- `@openuidev/react-lang`
- Tailwind CSS 4

## Scripts

- `npm run dev --workspace frontend`
- `npm run build --workspace frontend`
- `npm run lint --workspace frontend`
- `npm run preview --workspace frontend`

## Environment

Frontend env is optional. If no overrides are provided, the app uses `/api` as the backend base URL.

```bash
cp frontend/.env.example frontend/.env
```

Available variables:

- `VITE_API_BASE_URL` — backend base URL, default `/api`
- `VITE_DEV_API_TARGET` — Vite proxy target in development

Request guard values are loaded from `GET /api/config` when the app boots.

## Development flow

By default:

- Vite runs on `http://localhost:5555`
- API requests go to `/api/*`
- The dev proxy forwards `/api/*` to the backend target from `VITE_DEV_API_TARGET`, or to `http://localhost:<backend PORT>` inferred from `backend/.env`

## Key frontend features

- health polling against `/api/health`
- runtime config bootstrap from `/api/config`
- streaming generation via SSE
- fallback to non-streaming generation if streaming fails before the first chunk
- client-side prompt and chat-window guards before hitting the backend
- local persistence for builder and domain state through `redux-remember`
- chat autoscroll and import/export of saved definitions

## File map

- `src/api/apiSlice.ts` — RTK Query endpoints
- `src/features/builder/components/ChatPanel.tsx` — chat UI and generation flow
- `src/features/builder/components/PreviewTabs.tsx` — preview and definition tabs
- `src/features/builder/hooks/useHealthPolling.ts` — shared health polling config
- `src/store/store.ts` — Redux store setup
