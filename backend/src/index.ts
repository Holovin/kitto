import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = createApp(env);

function logShutdown(message: string) {
  if (env.LOG_LEVEL !== 'silent') {
    console.log(message);
  }
}

function logShutdownError(message: string, error?: Error) {
  if (env.LOG_LEVEL !== 'silent') {
    console.error(message);

    if (error) {
      console.error(error);
    }
  }
}

const server = serve(
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

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logShutdown(`Received ${signal}, shutting down...`);

  const forceTimer = setTimeout(() => {
    logShutdownError('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);

  try {
    server.close((error?: Error) => {
      clearTimeout(forceTimer);

      if (error) {
        logShutdownError('Shutdown failed.', error);
        process.exit(1);
        return;
      }

      logShutdown('Shutdown complete.');
      process.exit(0);
    });
  } catch (error) {
    clearTimeout(forceTimer);
    logShutdownError('Shutdown failed.', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

process.once('SIGTERM', () => {
  shutdown('SIGTERM');
});

process.once('SIGINT', () => {
  shutdown('SIGINT');
});
