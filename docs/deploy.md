# Production deployment

This app is deployed as one compiled Node process behind a reverse proxy:

- public origin: `https://your-domain.example`
- proxy target: `http://127.0.0.1:8888`
- process manager: PM2
- app process: `node backend/dist/index.js`

The backend serves both the frontend routes and `/api/*`. No separate frontend server is required.

## Prerequisites

- Node.js 22+
- npm 10+
- PM2 installed on the VPS
- a public domain already pointed at the VPS
- Nginx Proxy Manager running on the VPS

## Environment

Start from the production-oriented example file:

```bash
cp backend/.env.example backend/.env
```

Set at least:

- `OPENAI_API_KEY`
- `FRONTEND_ORIGIN=https://your-domain.example`

The default example keeps:

- `PORT=8888`
- `OPENAI_MODEL=gpt-5.4-mini`
- `LOG_LEVEL=info`
- `OPENAI_REQUEST_TIMEOUT_MS=120000`
- `LLM_CHAT_HISTORY_MAX_ITEMS=40`
- `LLM_PROMPT_MAX_CHARS=4096`
- `LLM_REQUEST_MAX_BYTES=300000`
- `LLM_OUTPUT_MAX_BYTES=100000`
- `LLM_RATE_LIMIT_MAX_REQUESTS=60`
- `LLM_RATE_LIMIT_WINDOW_MS=60000`

## First deploy

Run from the repo root:

```bash
npm ci
cp backend/.env.example backend/.env
# edit backend/.env
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 save
```

Notes:

- `npm run build` is the only required build command. It regenerates the OpenUI component spec, rebuilds the standalone player assets, and builds both workspaces.
- `ecosystem.config.cjs` uses one process in `fork` mode on purpose. Do not switch to cluster mode or `instances: max` because the current rate limiting is in-memory and process-local.
- PM2 includes a `kill_timeout` slightly longer than the app's 10 second shutdown window so reloads do not cut off graceful shutdown early.
- `backend/.env.example` is production-oriented. For local development, override it back to `PORT=8787` and `FRONTEND_ORIGIN=http://localhost:5555`.

## Update deploy

```bash
git pull
npm ci
npm run build
pm2 reload kitto-openui --update-env
```

## Verification

After the process starts, verify the local listener directly on the VPS:

```bash
curl -i http://127.0.0.1:8888/api/health
curl -i http://127.0.0.1:8888/
curl -i http://127.0.0.1:8888/chat
curl -i http://127.0.0.1:8888/elements
curl -i http://127.0.0.1:8888/missing
```

Expected results:

- `/api/health` returns `200` JSON
- `/`, `/chat`, and `/elements` return HTML
- `/missing` returns the JSON `404` contract

## Nginx Proxy Manager

Create one proxy host for the public domain with these settings:

- Forward Hostname / IP: `127.0.0.1`
- Forward Port: `8888`
- Websockets Support: optional, not required for the current app but safe to enable
- Block Common Exploits: enabled
- SSL: request a certificate
- Force SSL: enabled

No custom location routing is required. Nginx Proxy Manager should proxy the whole origin to the single PM2 process.

## Path requirements

Keep the PM2 process running from the repo root by using the provided `cwd: __dirname` in `ecosystem.config.cjs`.

That keeps the expected layout intact:

- `backend/dist`
- `frontend/dist`
- `shared/openui-component-spec.json`

The backend already resolves `backend/.env` relative to its own package path, so repo-root PM2 launches still load the correct env file.

If the deployment layout changes later, add an explicit frontend dist override such as `FRONTEND_DIST_DIR` at that time. The current deploy path does not need it.
