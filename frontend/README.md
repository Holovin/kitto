# Frontend

This package contains the Kitto builder UI. It lets you prompt the backend for OpenUI source, stream the draft into the browser, preview the generated app, inspect the raw definition, and explore the supported OpenUI surface from the `/elements` route.

## Stack

- React 19
- Vite 8
- React Router 7
- Redux Toolkit + RTK Query
- `@openuidev/react-lang`
- Tailwind CSS 4
- Radix UI primitives

## Routes

- `/` and `/chat` - main builder experience
- `/elements` - component and action explorer with live demos and schema views

## Builder behavior

- bootstraps request limits from `GET /api/config`
- polls `GET /api/health` every 30 seconds and on focus/reconnect
- streams generation from `POST /api/llm/generate/stream`
- falls back to `POST /api/llm/generate` if streaming fails before the first chunk
- validates generated OpenUI locally and retries automatic repair up to two times
- persists builder state in `localStorage`
- supports import/export, undo/redo, builder reset, and runtime state reset

## Supported OpenUI surface

### Components

`AppShell`, `Screen`, `Group`, `Repeater`, `Text`, `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, `Link`

### Actions

`read_state`, `write_state`, `merge_state`, `append_state`, `remove_state`

Use local OpenUI state such as `$currentScreen` plus `@Set(...)` for internal screen changes.
Persisted tool paths must be non-empty dot-paths up to 10 segments deep, use only letters, numbers, `_`, or `-`, and must never include `__proto__`, `prototype`, or `constructor`. `remove_state` also requires an explicit non-negative integer `index`.

## Scripts

- `npm run dev --workspace frontend`
- `npm run build --workspace frontend`
- `npm run lint --workspace frontend`
- `npm run preview --workspace frontend`

## Environment

Frontend env is optional:

```bash
cp frontend/.env.example frontend/.env
```

Available variables:

- `VITE_API_BASE_URL` - backend base URL used in the browser, default `/api`
- `VITE_DEV_API_TARGET` - Vite proxy target in development, default `http://localhost:8787`

## Local development

By default:

- Vite runs on `http://localhost:5555`
- frontend API calls go to `/api/*`
- the dev proxy forwards `/api/*` to `VITE_DEV_API_TARGET`
- if `VITE_DEV_API_TARGET` is not set, Vite reads `PORT` from `backend/.env` and falls back to `http://localhost:<PORT>`

## Key files

- `src/layouts/BaseLayout.tsx` - app shell, navigation, and connection badge
- `src/features/builder/components/ChatPanel.tsx` - prompt composer, chat feed, import/export, undo/redo
- `src/features/builder/components/PreviewTabs.tsx` - preview/definition tabs and runtime reset
- `src/features/builder/hooks/useBuilderSubmission.ts` - streaming, fallback, validation, and auto-repair flow
- `src/features/builder/hooks/useBuilderBootstrap.ts` - config bootstrap and health polling
- `src/pages/Elements/Elements.tsx` - schema explorer and live OpenUI sandbox
- `src/api/apiSlice.ts` - RTK Query endpoints
- `src/store/store.ts` - Redux store and persisted builder state
