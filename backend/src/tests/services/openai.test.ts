import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptBuildRequest } from '../../prompts/openui.js';
import { UpstreamFailureError } from '../../errors/publicError.js';
import { createTestEnv } from '../createTestEnv.js';

const { MockApiUserAbortError, responsesCreateMock, responsesStreamMock } = vi.hoisted(() => {
  class HoistedMockApiUserAbortError extends Error {
    constructor() {
      super('Request was aborted.');
      this.name = 'APIUserAbortError';
    }
  }

  return {
    MockApiUserAbortError: HoistedMockApiUserAbortError,
    responsesCreateMock: vi.fn(),
    responsesStreamMock: vi.fn(),
  };
});

vi.mock('openai', () => {
  class MockOpenAI {
    responses = {
      create: responsesCreateMock,
      stream: responsesStreamMock,
    };

    constructor(_options?: unknown) {}
  }

  return {
    APIUserAbortError: MockApiUserAbortError,
    default: MockOpenAI,
  };
});

import { generateOpenUiSource, streamOpenUiSource } from '../../services/openai.js';

const request: PromptBuildRequest = {
  chatHistory: [],
  currentSource: '',
  prompt: 'Build a todo app',
};

function createMockResponseStream(events: unknown[], finalResponse: unknown) {
  let aborted = false;

  return {
    abort: vi.fn(() => {
      aborted = true;
    }),
    finalResponse: vi.fn(async () => finalResponse),
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        if (aborted) {
          return;
        }

        yield event;
      }
    },
  };
}

describe('streamOpenUiSource', () => {
  afterEach(() => {
    responsesCreateMock.mockReset();
    responsesStreamMock.mockReset();
  });

  it('stops before processing a subsequent event after abort is observed', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-1',
    });
    const abortController = new AbortController();
    const onTextDelta = vi.fn((delta: string) => {
      if (delta === 'root = ') {
        abortController.abort();
      }
    });
    const stream = createMockResponseStream(
      [
        { type: 'response.output_text.delta', delta: 'root = ' },
        { type: 'response.output_text.delta', delta: 'AppShell([])' },
      ],
      { output_text: 'root = AppShell([])' },
    );

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, abortController.signal)).rejects.toBeInstanceOf(
      MockApiUserAbortError,
    );

    expect(onTextDelta).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledWith('root = ');
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });

  it('stops before calling onTextDelta when abort is observed mid-event processing', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-2',
    });
    const abortController = new AbortController();
    const onTextDelta = vi.fn();
    const abortingEvent = {
      type: 'response.output_text.delta',
      get delta() {
        abortController.abort();
        return 'root = AppShell([])';
      },
    };
    const stream = createMockResponseStream([abortingEvent], { output_text: 'root = AppShell([])' });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta, abortController.signal)).rejects.toBeInstanceOf(
      MockApiUserAbortError,
    );

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });

  it('rejects non-stream model output that exceeds the backend byte limit', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-3',
      LLM_OUTPUT_MAX_BYTES: 12,
    });

    responsesCreateMock.mockResolvedValue({
      output_text: 'root = AppShell([])',
    });

    await expect(generateOpenUiSource(env, request)).rejects.toBeInstanceOf(UpstreamFailureError);
    expect(responsesCreateMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the upstream stream when streamed output exceeds the backend byte limit', async () => {
    const env = createTestEnv({
      OPENAI_API_KEY: 'test-key-4',
      LLM_OUTPUT_MAX_BYTES: 6,
    });
    const onTextDelta = vi.fn();
    const stream = createMockResponseStream([{ type: 'response.output_text.delta', delta: 'root = ' }], {
      output_text: 'root = AppShell([])',
    });

    responsesStreamMock.mockReturnValue(stream);

    await expect(streamOpenUiSource(env, request, onTextDelta)).rejects.toBeInstanceOf(UpstreamFailureError);

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.finalResponse).not.toHaveBeenCalled();
  });
});
