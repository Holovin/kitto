import fs from 'node:fs/promises';
import { createApp } from '../backend/src/app.ts';
import { loadEnv } from '../backend/src/env.ts';
import { UpstreamFailureError } from '../backend/src/errors/publicError.ts';
import { resetOpenAiClientForTesting, setOpenAiClientFactoryForTesting } from '../backend/src/services/openai.ts';
import { resolvePromptIoLogPath } from '../backend/src/services/promptLog.ts';

type PromptIoFailureEntry = {
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  phase?: 'parse' | 'request' | 'stream';
  requestId?: string | null;
  ts?: string;
};

type SseEvent = {
  data: string;
  event: string;
};

const promptLogPath = resolvePromptIoLogPath();
const runId = `task107-${Date.now()}`;
const baseRequestPayload = {
  chatHistory: [],
  currentSource: '',
  mode: 'initial' as const,
  prompt: 'Build a tiny todo app with one screen.',
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPromptLogEntries(filePath: string) {
  try {
    const rawLog = await fs.readFile(filePath, 'utf8');

    return rawLog
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as PromptIoFailureEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function parseSseEvents(payload: string): SseEvent[] {
  return payload
    .split('\n\n')
    .filter(Boolean)
    .map((entry) => {
      const lines = entry.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? '';
      const data = lines
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n');

      return { data, event };
    });
}

async function provokeRequestFailure(app: ReturnType<typeof createApp>) {
  const requestId = `${runId}-request`;

  setOpenAiClientFactoryForTesting(() => ({
    responses: {
      create: async () => {
        await sleep(15);
        throw new UpstreamFailureError('The model service rejected the API key.');
      },
      stream: () => {
        throw new Error('Unexpected stream call during request failure scenario.');
      },
    },
  }));

  const response = await app.request('/api/llm/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-kitto-request-id': requestId,
    },
    body: JSON.stringify(baseRequestPayload),
  });
  const payload = await response.json();

  if (response.status !== 502 || payload.code !== 'upstream_error') {
    throw new Error(`Request-phase provocation failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return requestId;
}

async function provokeStreamFailure(app: ReturnType<typeof createApp>) {
  const requestId = `${runId}-stream`;

  setOpenAiClientFactoryForTesting(() => ({
    responses: {
      create: async () => {
        throw new Error('Unexpected non-stream call during stream failure scenario.');
      },
      stream: () => {
        let aborted = false;
        const timeoutError = new Error('The model request timed out.');

        timeoutError.name = 'TimeoutError';

        return {
          abort() {
            aborted = true;
          },
          async finalResponse() {
            throw new Error('finalResponse() should not be reached in the stream failure scenario.');
          },
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'response.output_text.delta' as const,
              delta: '{"summary":"Partial","source":"root = ',
            };

            await sleep(15);

            if (aborted) {
              return;
            }

            throw timeoutError;
          },
        };
      },
    },
  }));

  const response = await app.request('/api/llm/generate/stream', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-kitto-request-id': requestId,
    },
    body: JSON.stringify(baseRequestPayload),
  });
  const events = parseSseEvents(await response.text());

  if (response.status !== 200) {
    throw new Error(`Stream-phase provocation returned ${response.status} instead of 200.`);
  }

  if (events.length !== 2 || events[0]?.event !== 'chunk' || events[1]?.event !== 'error') {
    throw new Error(`Unexpected stream events for stream-phase provocation: ${JSON.stringify(events)}`);
  }

  const errorPayload = JSON.parse(events[1].data) as { code?: string };

  if (errorPayload.code !== 'timeout_error') {
    throw new Error(`Stream-phase provocation emitted the wrong error payload: ${events[1].data}`);
  }

  return requestId;
}

async function provokeParseFailure(app: ReturnType<typeof createApp>) {
  const requestId = `${runId}-parse`;

  setOpenAiClientFactoryForTesting(() => ({
    responses: {
      create: async () => {
        await sleep(15);

        return {
          output_text: 'not-json',
        };
      },
      stream: () => {
        throw new Error('Unexpected stream call during parse failure scenario.');
      },
    },
  }));

  const response = await app.request('/api/llm/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-kitto-request-id': requestId,
    },
    body: JSON.stringify(baseRequestPayload),
  });
  const payload = await response.json();

  if (response.status !== 502 || payload.code !== 'upstream_error') {
    throw new Error(`Parse-phase provocation failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return requestId;
}

function assertFailureEntry(entry: PromptIoFailureEntry | undefined, phase: 'parse' | 'request' | 'stream') {
  if (!entry) {
    throw new Error(`Missing ${phase} failure entry in ${promptLogPath}.`);
  }

  if (entry.phase !== phase) {
    throw new Error(`Expected ${phase} entry, received ${String(entry.phase)}.`);
  }

  if (typeof entry.errorCode !== 'string' || entry.errorCode.length === 0) {
    throw new Error(`${phase} failure entry is missing errorCode.`);
  }

  if (typeof entry.durationMs !== 'number' || !Number.isFinite(entry.durationMs)) {
    throw new Error(`${phase} failure entry is missing durationMs.`);
  }
}

async function main() {
  const env = {
    ...loadEnv(),
    LOG_LEVEL: 'silent' as const,
    OPENAI_API_KEY: 'task107-provoker-key',
    PROMPT_IO_LOG: true,
  };
  const app = createApp(env);
  const beforeEntries = await readPromptLogEntries(promptLogPath);

  try {
    const requestRequestId = await provokeRequestFailure(app);
    const streamRequestId = await provokeStreamFailure(app);
    const parseRequestId = await provokeParseFailure(app);
    const afterEntries = await readPromptLogEntries(promptLogPath);
    const requestedIds = new Set([requestRequestId, streamRequestId, parseRequestId]);
    const newFailureEntries = afterEntries.filter((entry) => entry.requestId && requestedIds.has(entry.requestId));

    if (newFailureEntries.length !== 3) {
      throw new Error(
        `Expected 3 new failure entries, found ${newFailureEntries.length}. Log delta=${afterEntries.length - beforeEntries.length}.`,
      );
    }

    const requestEntry = newFailureEntries.find((entry) => entry.requestId === requestRequestId);
    const streamEntry = newFailureEntries.find((entry) => entry.requestId === streamRequestId);
    const parseEntry = newFailureEntries.find((entry) => entry.requestId === parseRequestId);

    assertFailureEntry(requestEntry, 'request');
    assertFailureEntry(streamEntry, 'stream');
    assertFailureEntry(parseEntry, 'parse');

    console.log(`Prompt log: ${promptLogPath}`);
    console.log(`New failure entries: ${newFailureEntries.length}`);

    for (const entry of [requestEntry, streamEntry, parseEntry]) {
      console.log(
        `${entry?.phase} requestId=${entry?.requestId} errorCode=${entry?.errorCode} durationMs=${entry?.durationMs} message=${entry?.errorMessage ?? ''}`,
      );
    }
  } finally {
    resetOpenAiClientForTesting();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
