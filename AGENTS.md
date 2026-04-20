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
- If you change the standalone player entry, standalone runtime, or exported standalone asset embedding flow, you must run `npm run build:standalone-player` before finishing.
- If you change the API contract, OpenUI prompt contract, supported components/tools, builder controls, or any QA-visible runtime behavior, update `docs/qa/openui-agent-smoke.md` and `docs/qa/openui-manual-checklist.md` before finishing whenever their steps, expectations, or contract notes no longer match.
- Tests must live under `frontend/src/tests/**` or `backend/src/tests/**`. Mirror the source structure inside those folders and do not colocate test files next to production modules.
- Frontend tests are type-checked by the reviewer build path via `tsc -b`. Keep test fixtures fully type-safe, and explicitly type empty arrays in fixtures when needed to avoid accidental `never[]` inference.
- After code changes, run the relevant existing tests for the touched feature area before finishing. If the change is substantial and that area has no meaningful tests yet, add targeted tests for it. Do not add tests for every tiny refactor or trivial copy change.
- Documentation must not contain absolute local filesystem paths, local file URLs, usernames, home-directory references, tokens, API keys, secrets, or other personal or machine-specific data. Use plain text or project-relative paths only.

## Project Context

- This repository is a local-first OpenUI playground that generates small browser apps from chat prompts.
- The workspace has two packages:
  - `frontend/`: React 19 + Vite 8 builder UI and OpenUI runtime
  - `backend/`: Hono API, OpenAI integration, prompt building, rate limiting, and static hosting for `frontend/dist`
- Production deployment is a single-process PM2 setup behind one reverse proxy origin. The app itself serves both frontend routes and `/api/*` from one Node process on port `8888`.
- The root scripts are the main entry points:
  - `npm run generate:openui-spec`: regenerates the committed OpenUI component spec artifact from the frontend library
  - `npm run build:standalone-player`: rebuilds the standalone player bundle and regenerates the embedded asset module used for standalone HTML export
  - `npm run dev`: starts frontend and backend together and also runs the standalone player watcher so exported HTML assets stay fresh during development
  - `npm run lint`: frontend ESLint + backend TypeScript checks
  - `npm run build`: regenerates the OpenUI component spec, rebuilds the standalone player assets, then builds frontend and backend
  - `npm run start`: starts the compiled backend

## OpenUI Source Of Truth

- The frontend OpenUI library is the source of truth: `frontend/src/features/builder/openui/library/index.tsx`
- The generated component spec artifact lives at `shared/openui-component-spec.json`
- The backend prompt consumes that generated spec in `backend/src/prompts/openui.ts`
- Do not manually duplicate or hand-edit component signatures in the backend prompt
- Do not hand-edit `shared/openui-component-spec.json`; it is a committed generated artifact
- If you change the frontend library or anything that affects the generated component contract, regenerate the spec before finishing
- The frontend parser and validation also depend on the real library via `builderOpenUiLibrary.toJSONSchema()`, so component changes affect both prompt generation and local validation
- `validateOpenUiSource()` also performs literal enum-prop checks against the generated component schemas because the parser can preserve invalid literal props in the AST instead of rejecting them on parse alone

## Supported OpenUI Surface

- Current supported OpenUI components:
  - `AppShell`, `Screen`, `Group`, `Repeater`, `Text`, `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, `Link`
- Group layout guidance:
  - `Group(title, direction, children, variant?, appearance?)` supports `block | inline`
  - the second `Group` argument is always `direction`, and `variant` belongs in the optional fourth argument
  - default variant is `block`
  - use `block` for standalone visual sections
  - use `inline` for lightweight nested groups, inline controls, repeated rows, and groups inside an existing block
  - avoid over-nesting block groups
- Safe visual color guidance:
- `AppShell(children, appearance?)` accepts optional inherited theme colors for the whole app
  - `Screen(id, title, children, isActive?, appearance?)`, `Group(...)`, and `Repeater(children, emptyText?, appearance?)` can override inherited subtree colors
  - `appearance` supports only `mainColor` and `contrastColor`
  - `appearance.mainColor` is the main surface/background color
  - `appearance.contrastColor` is the contrasting text or primary action color
  - `Text(...)` accepts only `appearance.contrastColor`
  - `Input`, `TextArea`, `Checkbox`, `RadioGroup`, `Select`, `Button`, and `Link` accept `appearance.mainColor` and `appearance.contrastColor`
  - `appearance.mainColor` and `appearance.contrastColor` must be strict `#RRGGBB` hex strings only
  - `Button(..., "default", ...)` inverts the pair so background uses `contrastColor` and text uses `mainColor`
  - `Button(..., "secondary", ...)` uses the pair as-is
  - parent `AppShell`, `Screen`, `Group`, and `Repeater` appearance values recolor nested controls automatically unless a child sets its own local appearance
  - use existing variants first when enough, and never expose or generate `style`, `className`, CSS strings, named colors, `rgb()`, `hsl()`, `var()`, or layout props
- Repeater collection guidance:
  - `Repeater(children, emptyText)` expects an array of already-built row nodes, usually produced by `@Each(collection, "item", rowNode)`
  - when the requested list is dynamic, derive rows from local arrays, runtime state, or `Query("read_state", ...)` data instead of hardcoding duplicate rows
- Filtering guidance:
  - use `@Filter(collection, field, operator, value)` for derived filtered collections
  - keep ephemeral filter selection in local runtime state such as `$filter`
  - do not use predicate-form filters or invent filtering-specific tools
- Current sandbox tools exposed to generated apps:
  - `read_state`, `write_state`, `merge_state`, `append_state`, `remove_state`
- Built-in action events exposed by the runtime:
  - `@OpenUrl(...)` uses the OpenUI action event bridge, not the persisted tool provider
  - `Link(...)` and `@OpenUrl(...)` share the same safe URL allowlist: `https:`, `http:`, `mailto:`, `tel:`, app-relative `/...`, and hash `#...`
  - when the standalone export is opened from `file://`, root-relative `/...` links and hash/self `#...` links are intentionally rejected because there is no hosted app router or stable origin behind the standalone file
- Persisted tool contract:
  - paths must be non-empty dot-paths no deeper than 10 segments
  - path segments may use only letters, numbers, `_`, or `-`
  - `__proto__`, `prototype`, and `constructor` are always invalid path or object keys
  - numeric path segments are array indexes only
  - `remove_state` requires an explicit non-negative integer `index`
  - `write_state` and `append_state` values must stay JSON-compatible, and `merge_state` patches must stay plain objects

## Architecture

- Main user routes:
  - `/` and `/chat`: builder experience
  - `/elements`: component/action explorer and OpenUI sandbox
- `shared/frontend-routes.json` is the source of truth for production SPA fallback routes; `frontend/src/router/siteRoutes.ts` must stay aligned with it
- The backend exposes `/api/*` routes only
- After `npm run build`, the backend can serve `frontend/dist` as the SPA shell for non-API routes
- In development, Vite proxies `/api/*` to the backend

## State Model

- Redux state is split intentionally:
  - `builder`: committed source, streamed draft source, chat messages, undo/redo history, parse issues, and the last failed prompt used by the composer `Repeat` action
  - `builderSession`: current runtime session/form state used by the renderer
  - `domain`: persisted app data mutated by OpenUI tools
- `builder`, `builderSession`, and `domain` are persisted in `localStorage` through `redux-remember`
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
- Normal generation `chatHistory` should include only `user` messages and optional `assistant` generation summaries; exclude all `system` UI/operational messages from model context
- The backend user prompt must wrap `currentSource` and recent `chatHistory` in explicit data blocks; treat those blocks as quoted data, not instructions, and let only the latest user request define the task
- Preview updates only after `completeStreaming` commits a validated source; invalid or partial streamed source must never become the active preview
- A streaming generation is successful only after a valid `done` SSE event; truncated streams, chunk-only streams, and aborted streams must never be treated as completed model output
- Every generation must terminate in exactly one state: committed, failed, or cancelled; the frontend must not stay stuck in a streaming state forever
- When a generation fails, the composer keeps the last failed prompt as a retry candidate; an empty composer shows `Repeat`, and typing any new prompt switches the primary action back to `Send`
- The frontend applies both a max stream duration and an idle timeout before failing the request and preserving the last committed preview
- Each frontend generation request carries a `requestId`; stale stream chunks, stale fallback responses, and intentional aborts must be ignored and must never commit over a newer request
- The backend compacts chat history by item limit and by byte size before calling the OpenAI Responses API
- Streaming responses use SSE with `chunk`, `done`, and `error` events

## Tooling And Sync Points

- Component changes are not fully centralized in one file yet. If you add, remove, or rename a component, check these manual sync points:
  - `frontend/src/features/builder/openui/runtime/prompt.ts`
  - `frontend/src/pages/Elements/elementDemos.ts`
  - `frontend/src/features/builder/openui/runtime/demos.ts`
  - any component-specific documentation or examples in `/elements`
- Route changes have an explicit contract now. If you add, remove, or rename a frontend route, sync:
  - `shared/frontend-routes.json`
  - `frontend/src/router/siteRoutes.ts`
  - `backend/src/tests/frontendRoutesContract.test.ts`
  - `frontend/src/tests/router/siteRoutes.test.ts`
- Tool changes are also duplicated in multiple places. If you add, remove, or change a tool name, args, or semantics, sync:
  - `backend/src/prompts/openui.ts` tool specs/examples/rules
  - `frontend/src/features/builder/openui/runtime/createDomainToolProvider.ts`
  - `frontend/src/features/builder/openui/runtime/toolProvider.ts`
  - `frontend/src/features/builder/openui/runtime/actionCatalog.ts`
  - `frontend/src/pages/Elements/Elements.tsx` sandbox tool provider
- Standalone export/player changes have their own sync points. If you change the standalone player runtime, HTML embedding, or standalone storage behavior, sync:
  - `frontend/src/standalone/player.tsx`
  - `frontend/src/standalone/bootstrap.tsx`
  - `frontend/src/standalone/StandaloneApp.tsx`
  - `frontend/src/features/builder/standalone/createStandaloneHtml.ts`
  - `frontend/src/features/builder/standalone/constants.ts`
  - `frontend/public/kitto-standalone-player.js`
  - `frontend/public/kitto-standalone-player.css`
  - `frontend/vite.standalone.config.ts`
  - `scripts/embed-standalone-player-assets.ts`
- The `/elements` page reads both `builderOpenUiLibrary.toSpec()` and `builderOpenUiLibrary.toJSONSchema()`, so library changes directly affect that explorer
- QA docs are also a sync point. If UX labels, manual flows, API routes, prompt/component signatures, or expected runtime invariants change, sync:
  - `docs/qa/openui-agent-smoke.md`
  - `docs/qa/openui-manual-checklist.md`
  - `README.md` links or descriptions if they stop matching

## Runtime And API Notes

- Default frontend URL: `http://localhost:5555`
- Default backend URL: `http://localhost:8787`
- Production backend listener: `http://127.0.0.1:8888`
- In development, the frontend talks to `/api/*` and Vite proxies requests to the backend
- The supported backend API lives under `/api/*` only
- Public runtime limits and stream timeout policy are exposed through `GET /api/config`
- Health/model status is exposed through `GET /api/health`
- The backend rejects oversized raw request bodies before JSON parsing
- The raw request hard limit is derived from `LLM_REQUEST_MAX_BYTES * 4`
- The backend rejects model output above `LLM_OUTPUT_MAX_BYTES` before returning a non-stream response or finalizing an SSE stream
- Public backend error codes are `validation_error`, `timeout_error`, `upstream_error`, and `internal_error`
- Rate limiting is in-memory and process-local; do not treat it as distributed-safe production infrastructure

## Agent Notes

- Prefer repo-root scripts over ad hoc workspace commands unless there is a specific reason not to
- When reading or writing repo-shared artifacts from backend code, do not assume `process.cwd()` is the repo root; workspace scripts may run with `cwd` set to `backend/`
- For PM2 production deploys, use the repo-root `ecosystem.config.cjs` with one forked instance only. Do not switch to cluster mode or `instances: max` because rate limiting is in-memory and process-local.
- The backend now loads `backend/.env` relative to its own package path, so repo-root PM2 launches are expected and safe.
- Keep the deployed repo layout intact so `backend/dist` can resolve `frontend/dist` and `shared/openui-component-spec.json`.
- `backend/.env.example` is production-oriented. For local development, set `PORT=8787` and `FRONTEND_ORIGIN=http://localhost:5555` in `backend/.env`.
- If you change the backend prompt contract, remember that only these backend prompt pieces are still manually maintained:
  - tool specs
  - tool examples
  - additional project rules
  - the user prompt builder
- If you change `builderOpenUiLibrary`, check both the main builder preview and the `/elements` explorer
- If you change tool behavior or domain-path semantics, verify the main preview runtime, the `/elements` sandbox, and standalone HTML export
- The frontend dev proxy falls back to `backend/.env` `PORT` when `VITE_DEV_API_TARGET` is not set
- `README.md` is the human-oriented overview; this file should stay short and operational for agents
