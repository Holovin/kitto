# AGENTS.md

## Documentation

### Context7

Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use it even when the library is well known. Prefer Context7 over web search for library docs.

Do not use Context7 for refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

Steps:

1. Always start with `resolve-library-id` using the library name and the user's question, unless the user provides an exact library ID in `/org/project` format.
2. Pick the best match by exact name match, description relevance, code snippet count, source reputation, and benchmark score.
3. Run `query-docs` with the selected library ID and the user's full question.
4. Answer using the fetched docs.

## Repository Rules

- If you update the OpenUI component spec, or change the frontend OpenUI library that defines it, you must run `npm run generate:openui-spec` before finishing.
- If you change the API contract, OpenUI prompt contract, supported components/tools, builder controls, or any QA-visible runtime behavior, update `docs/qa/openui-agent-smoke.md` and `docs/qa/openui-manual-checklist.md` before finishing whenever their steps, expectations, or contract notes no longer match.
- Documentation must not contain absolute local filesystem paths, local file URLs, usernames, home-directory references, tokens, API keys, secrets, or other personal or machine-specific data. Use plain text or project-relative paths only.

## Project Context

- This repository is a local-first OpenUI playground that generates small browser apps from chat prompts.
- The workspace has two packages:
  - `frontend/`: React 19 + Vite 8 builder UI and OpenUI runtime
  - `backend/`: Hono API, OpenAI integration, prompt building, rate limiting, and static hosting for `frontend/dist`
- The root scripts are the main entry points:
  - `npm run dev`: starts frontend and backend together
  - `npm run lint`: frontend ESLint + backend TypeScript checks
  - `npm run build`: regenerates the OpenUI component spec, then builds frontend and backend
  - `npm run start`: starts the compiled backend

## OpenUI Source Of Truth

- The frontend OpenUI library is the source of truth: `frontend/src/features/builder/openui/library/index.tsx`
- The generated component spec artifact lives at `shared/openui/component-spec.json`
- The backend prompt consumes that generated spec in `backend/src/prompts/openui.ts`
- Do not manually duplicate or hand-edit component signatures in the backend prompt
- Do not hand-edit `shared/openui/component-spec.json`; it is a committed generated artifact
- If you change the frontend library or anything that affects the generated component contract, regenerate the spec before finishing
- The frontend parser and validation also depend on the real library via `builderOpenUiLibrary.toJSONSchema()`, so component changes affect both prompt generation and local validation

## Supported OpenUI Surface

- Current supported OpenUI components:
  - `AppShell`, `Screen`, `Group`, `Repeater`, `Text`, `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, `Link`
- Current sandbox tools exposed to generated apps:
  - `read_state`, `write_state`, `merge_state`, `append_state`, `remove_state`

## Architecture

- Main user routes:
  - `/` and `/chat`: builder experience
  - `/elements`: component/action explorer and OpenUI sandbox
- The backend exposes `/api/*` routes only
- After `npm run build`, the backend can serve `frontend/dist` as the SPA shell for non-API routes
- In development, Vite proxies `/api/*` to the backend

## State Model

- Redux state is split intentionally:
  - `builder`: committed source, streamed draft source, chat messages, undo/redo history, parse issues
  - `builderSession`: current runtime session/form state used by the renderer
  - `domain`: persisted app data mutated by OpenUI tools
- `builder` is persisted in `localStorage` through `redux-remember`
- Import/export uses a versioned JSON format; the current exported format is `version: 1`
- Preview must always render from the last committed valid source; streamed draft source may be shown in Definition during generation, but must not mount in Preview before commit
- A committed snapshot stores:
  - `source`
  - `runtimeState`
  - `domainData`
  - `initialRuntimeState`
  - `initialDomainData`
- Internal screen flow should stay in local OpenUI runtime state such as `$currentScreen`; `domainData` is for persisted tool-backed data only

## Generation Flow

- The frontend prefers streaming via `POST /api/llm/generate/stream`
- If streaming fails before the first chunk, the frontend falls back to `POST /api/llm/generate`
- The frontend validates generated OpenUI locally against `builderOpenUiLibrary.toJSONSchema()`
- The frontend rejects OpenUI source above 50,000 characters or 300 statements before commit, import, or restore; rejected streamed or imported source stays in Definition while Preview keeps the last committed source
- If the generated source is invalid, the frontend performs 1 automatic repair attempt by sending a repair prompt back to the backend
- The repair prompt includes the original user request, the current committed valid source, the invalid draft, validation issues, and the current critical OpenUI syntax rules
- During repair, keep `request.currentSource` pointed at the last committed valid source; include the invalid draft in the repair prompt instead of replacing the request baseline
- Preview updates only after `completeStreaming` commits a validated source; invalid or partial streamed source must never become the active preview
- The backend compacts chat history by item limit and by byte size before calling the OpenAI Responses API
- Streaming responses use SSE with `chunk`, `done`, and `error` events

## Tooling And Sync Points

- Component changes are not fully centralized in one file yet. If you add, remove, or rename a component, check these manual sync points:
  - `frontend/src/features/builder/openui/runtime/prompt.ts`
  - `frontend/src/pages/Elements/elementDemos.ts`
  - `frontend/src/features/builder/openui/runtime/demos.ts`
  - any component-specific documentation or examples in `/elements`
- Tool changes are also duplicated in multiple places. If you add, remove, or change a tool name, args, or semantics, sync:
  - `backend/src/prompts/openui.ts` tool specs/examples/rules
  - `frontend/src/features/builder/openui/runtime/toolProvider.ts`
  - `frontend/src/features/builder/openui/runtime/actionCatalog.ts`
  - `frontend/src/pages/Elements/Elements.tsx` sandbox tool provider
- The `/elements` page reads both `builderOpenUiLibrary.toSpec()` and `builderOpenUiLibrary.toJSONSchema()`, so library changes directly affect that explorer
- QA docs are also a sync point. If UX labels, manual flows, API routes, prompt/component signatures, or expected runtime invariants change, sync:
  - `docs/qa/openui-agent-smoke.md`
  - `docs/qa/openui-manual-checklist.md`
  - `README.md` links or descriptions if they stop matching

## Runtime And API Notes

- Default frontend URL: `http://localhost:5555`
- Default backend URL: `http://localhost:8787`
- In development, the frontend talks to `/api/*` and Vite proxies requests to the backend
- The supported backend API lives under `/api/*` only
- Legacy root-level routes such as `/health`, `/config`, and `/llm/*` are intentionally not supported
- Public runtime limits are exposed through `GET /api/config`
- Health/model status is exposed through `GET /api/health`
- The backend rejects oversized raw request bodies before JSON parsing
- The raw request hard limit is derived from `LLM_REQUEST_MAX_BYTES * 4`
- Public backend error codes are `validation_error`, `timeout_error`, `upstream_error`, and `internal_error`
- Rate limiting is in-memory and process-local; do not treat it as distributed-safe production infrastructure

## Agent Notes

- Prefer repo-root scripts over ad hoc workspace commands unless there is a specific reason not to
- When reading or writing repo-shared artifacts from backend code, do not assume `process.cwd()` is the repo root; workspace scripts may run with `cwd` set to `backend/`
- If you change the backend prompt contract, remember that only these backend prompt pieces are still manually maintained:
  - tool specs
  - tool examples
  - additional project rules
  - the user prompt builder
- If you change `builderOpenUiLibrary`, check both the main builder preview and the `/elements` explorer
- If you change tool behavior or domain-path semantics, verify both the main preview runtime and the `/elements` sandbox
- The frontend dev proxy falls back to `backend/.env` `PORT` when `VITE_DEV_API_TARGET` is not set
- `README.md` is the human-oriented overview; this file should stay short and operational for agents
