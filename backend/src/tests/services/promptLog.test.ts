import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOpenUiRawUserRequest, buildOpenUiUserPrompt } from '../../prompts/openui.js';
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
        rawUserRequest: 'u'.repeat(40),
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
      rawUserRequest: string;
      validationIssues: string[];
    };

    expect(entry.rawUserRequest).toBe('uuuuuuuuuuuuuuuu… [truncated 24 chars]');
    expect(entry.modelInput.input[0]?.content[0]?.text).toBe('mmmmmmmmmmmmmmmm… [truncated 24 chars]');
    expect(entry.modelOutputRaw).toBe('oooooooooooooooo… [truncated 24 chars]');
    expect(entry.parsedEnvelope.source).toBe('ssssssssssssssss… [truncated 24 chars]');
    expect(entry.parsedEnvelope.summary).toBe('yyyyyyyyyyyyyyyy… [truncated 24 chars]');
    expect(entry.parsedEnvelope.notes[0]).toBe('nnnnnnnnnnnnnnnn… [truncated 24 chars]');
    expect(entry.validationIssues[0]).toBe('vvvvvvvvvvvvvvvv… [truncated 24 chars]');
  });

  it('stores only rawUserRequest and keeps representative JSONL entries under 70% of the legacy size', async () => {
    const { cleanup, filePath } = await createTempLogFilePath();
    cleanupTasks.push(cleanup);

    const request = {
      prompt: 'Build a todo app with filters and a second screen for settings.',
      currentSource: 'root = AppShell([Screen("main", "Main", [Text("Hello")], true)])',
      mode: 'initial' as const,
      chatHistory: [
        { role: 'user' as const, content: 'Start with a tiny todo app.' },
        { role: 'assistant' as const, content: 'Built a one-screen todo app.' },
        { role: 'user' as const, content: 'Add filters and settings.' },
      ],
    };
    const userPrompt = buildOpenUiUserPrompt(request, {
      chatHistoryMaxItems: 8,
      structuredOutput: true,
    });
    const rawUserRequest = buildOpenUiRawUserRequest(request);
    const sharedEntryFields = {
      ts: '2026-04-21T10:00:00.000Z',
      requestId: 'request-optimized',
      parentRequestId: null,
      mode: request.mode,
      currentSourceLen: request.currentSource.length,
      chatHistoryLen: request.chatHistory.length,
      systemPromptHash: 'hash123',
      modelInput: {
        input: [
          {
            content: [{ text: '[omitted; see systemPromptHash]', type: 'input_text' }],
            role: 'system',
          },
          {
            content: [{ text: userPrompt, type: 'input_text' }],
            role: 'user',
          },
        ],
      },
      modelOutputRaw: '{"summary":"Builds app.","source":"root = AppShell([])","notes":[]}',
      parsedEnvelope: {
        notes: [],
        source: 'root = AppShell([])',
        summary: 'Builds app.',
      },
      usage: {
        input_tokens: 123,
        output_tokens: 45,
        total_tokens: 168,
      },
      durationMs: 321,
    };
    const legacyEntryLine = JSON.stringify({
      ...sharedEntryFields,
      userPrompt,
    });
    const userRequestMatch = userPrompt.match(/<user_request>\n([\s\S]*?)\n<\/user_request>/);

    await promptLog.write(
      {
        ...sharedEntryFields,
        rawUserRequest,
      },
      {
        enabled: true,
        filePath,
      },
    );

    const serializedLog = await readFile(filePath, 'utf8');
    const [optimizedLine] = serializedLog.trim().split('\n');

    expect(optimizedLine).toBeTruthy();
    expect(Buffer.byteLength(optimizedLine ?? '', 'utf8')).toBeLessThanOrEqual(Buffer.byteLength(legacyEntryLine, 'utf8') * 0.7);

    const entry = JSON.parse(optimizedLine ?? '{}') as {
      rawUserRequest: string;
      userPrompt?: unknown;
    };

    expect(entry.rawUserRequest).toBe(rawUserRequest);
    expect(entry.rawUserRequest).toBe(userRequestMatch?.[1]);
    expect(entry).not.toHaveProperty('userPrompt');
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
        rawUserRequest: 'Repair the invalid app',
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
        rawUserRequest: 'Build a todo app',
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
