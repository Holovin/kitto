import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PROMPT_IO_LOG_MAX_CHARS = 16_000;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface PromptIoLogEntry {
  ts: string;
  requestId: string | null;
  mode: 'initial' | 'repair';
  userPrompt: string;
  currentSourceLen: number;
  chatHistoryLen: number;
  systemPromptHash: string;
  modelInput?: unknown;
  modelOutputRaw: string;
  parsedEnvelope: unknown;
  usage: unknown;
  validationIssues?: string[];
  durationMs: number;
}

interface PromptLogWriteOptions {
  enabled: boolean;
  filePath?: string;
  maxStringChars?: number;
}

let writeQueue: Promise<void> = Promise.resolve();

export function resolvePromptIoLogPath(moduleUrl: string | URL = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../logs/prompt-io.jsonl');
}

function truncateString(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]`;
}

function sanitizeForJson(value: unknown, maxStringChars: number): JsonValue | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return truncateString(value, maxStringChars);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitizedItem = sanitizeForJson(item, maxStringChars);
      return sanitizedItem === undefined ? [] : [sanitizedItem];
    });
  }

  if (typeof value === 'object') {
    const sanitizedRecord: Record<string, JsonValue> = {};

    for (const [key, entryValue] of Object.entries(value)) {
      const sanitizedEntry = sanitizeForJson(entryValue, maxStringChars);

      if (sanitizedEntry !== undefined) {
        sanitizedRecord[key] = sanitizedEntry;
      }
    }

    return sanitizedRecord;
  }

  return undefined;
}

export const promptLog = {
  async write(entry: PromptIoLogEntry, options: PromptLogWriteOptions) {
    if (!options.enabled) {
      return;
    }

    const filePath = options.filePath ?? resolvePromptIoLogPath();
    const maxStringChars = options.maxStringChars ?? DEFAULT_PROMPT_IO_LOG_MAX_CHARS;
    const serializedEntry = sanitizeForJson(entry, maxStringChars);

    if (!serializedEntry || Array.isArray(serializedEntry) || typeof serializedEntry !== 'object') {
      throw new Error('Prompt log entry must serialize to a JSON object.');
    }

    const line = `${JSON.stringify(serializedEntry)}\n`;

    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, line, 'utf8');
    });

    await writeQueue;
  },
};
