import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { promptLog } from '../../services/promptLog.js';

async function createTempLogFilePath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kitto-prompt-log-'));
  return {
    cleanup: () => rm(directory, { force: true, recursive: true }),
    filePath: path.join(directory, 'prompt-io.jsonl'),
  };
}

describe('promptLog.write', () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanupTasks.splice(0).map((cleanup) => cleanup()));
  });

  it('serializes JSONL entries and truncates oversized string fields', async () => {
    const { cleanup, filePath } = await createTempLogFilePath();
    cleanupTasks.push(cleanup);

    await promptLog.write(
      {
        ts: '2026-04-21T10:00:00.000Z',
        requestId: 'request-123',
        mode: 'repair',
        userPrompt: 'u'.repeat(40),
        currentSourceLen: 50_000,
        chatHistoryLen: 7,
        systemPromptHash: 'abc123def456',
        modelInput: {
          input: [
            {
              content: [{ text: 'm'.repeat(40), type: 'input_text' }],
              role: 'user',
            },
          ],
        },
        modelOutputRaw: 'o'.repeat(40),
        parsedEnvelope: {
          notes: ['n'.repeat(40)],
          source: 's'.repeat(40),
          summary: 'y'.repeat(40),
        },
        usage: {
          input_tokens: 123,
          output_tokens: 45,
          total_tokens: 168,
        },
        validationIssues: ['v'.repeat(40)],
        durationMs: 321,
      },
      {
        enabled: true,
        filePath,
        maxStringChars: 16,
      },
    );

    const serializedLog = await readFile(filePath, 'utf8');
    const [line] = serializedLog.trim().split('\n');

    expect(line).toBeTruthy();

    const entry = JSON.parse(line ?? '{}') as {
      modelInput: { input: Array<{ content: Array<{ text: string }> }> };
      modelOutputRaw: string;
      parsedEnvelope: { notes: string[]; source: string; summary: string };
      userPrompt: string;
      validationIssues: string[];
    };

    expect(entry.userPrompt).toBe('uuuuuuuuuuuuuuuu… [truncated 24 chars]');
    expect(entry.modelInput.input[0]?.content[0]?.text).toBe('mmmmmmmmmmmmmmmm… [truncated 24 chars]');
    expect(entry.modelOutputRaw).toBe('oooooooooooooooo… [truncated 24 chars]');
    expect(entry.parsedEnvelope.source).toBe('ssssssssssssssss… [truncated 24 chars]');
    expect(entry.parsedEnvelope.summary).toBe('yyyyyyyyyyyyyyyy… [truncated 24 chars]');
    expect(entry.parsedEnvelope.notes[0]).toBe('nnnnnnnnnnnnnnnn… [truncated 24 chars]');
    expect(entry.validationIssues[0]).toBe('vvvvvvvvvvvvvvvv… [truncated 24 chars]');
  });

  it('serializes failure JSONL entries with error metadata', async () => {
    const { cleanup, filePath } = await createTempLogFilePath();
    cleanupTasks.push(cleanup);

    await promptLog.writeFailure(
      {
        ts: '2026-04-21T10:00:00.000Z',
        requestId: 'request-failure',
        parentRequestId: 'request-parent',
        mode: 'repair',
        userPrompt: 'Repair the invalid app',
        currentSourceLen: 123,
        chatHistoryLen: 4,
        systemPromptHash: 'hash123',
        modelInput: {
          input: [{ content: [{ text: 'model input body', type: 'input_text' }], role: 'user' }],
        },
        modelOutputRaw: '{"summary":"broken"',
        parsedEnvelope: null,
        usage: null,
        validationIssues: ['unresolved-reference'],
        errorCode: 'timeout_error',
        errorMessage: 'The model request timed out.',
        phase: 'stream',
        durationMs: 456,
      },
      {
        enabled: true,
        filePath,
        maxStringChars: 16,
      },
    );

    const serializedLog = await readFile(filePath, 'utf8');
    const [line] = serializedLog.trim().split('\n');
    const entry = JSON.parse(line ?? '{}') as {
      errorCode: string;
      errorMessage: string;
      modelOutputRaw: string;
      parentRequestId: string;
      phase: string;
    };

    expect(entry.parentRequestId).toBe('request-parent');
    expect(entry.errorCode).toBe('timeout_error');
    expect(entry.errorMessage).toBe('The model reques… [truncated 12 chars]');
    expect(entry.phase).toBe('stream');
    expect(entry.modelOutputRaw).toBe('{"summary":"brok… [truncated 3 chars]');
  });

  it('is a no-op when disabled', async () => {
    const { cleanup, filePath } = await createTempLogFilePath();
    cleanupTasks.push(cleanup);

    await promptLog.write(
      {
        ts: '2026-04-21T10:00:00.000Z',
        requestId: 'request-disabled',
        mode: 'initial',
        userPrompt: 'Build a todo app',
        currentSourceLen: 0,
        chatHistoryLen: 0,
        systemPromptHash: 'hash',
        modelOutputRaw: '{"source":"root = AppShell([])"}',
        parsedEnvelope: null,
        usage: null,
        durationMs: 12,
      },
      {
        enabled: false,
        filePath,
      },
    );

    await expect(access(filePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
