import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = createApp(env);

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    if (env.LOG_LEVEL !== 'silent') {
      console.log(`Kitto backend listening on http://localhost:${info.port}`);
    }
  },
);
