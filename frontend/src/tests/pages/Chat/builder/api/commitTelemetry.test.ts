import { afterEach, describe, expect, it, vi } from 'vitest';
import { postCommitTelemetry } from '@pages/Chat/builder/api/commitTelemetry';
import { toBuilderRequestId } from '@pages/Chat/builder/types';

describe('postCommitTelemetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the generation request id as transport metadata and in the JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await postCommitTelemetry({
      commitSource: 'streaming',
      committed: true,
      qualityWarnings: ['quality-unrequested-theme'],
      requestId: toBuilderRequestId('builder-request-123'),
      validationIssues: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/llm/commit-telemetry',
      expect.objectContaining({
        body: JSON.stringify({
          commitSource: 'streaming',
          committed: true,
          qualityWarnings: ['quality-unrequested-theme'],
          requestId: toBuilderRequestId('builder-request-123'),
          validationIssues: [],
        }),
        headers: expect.objectContaining({
          'x-kitto-request-id': 'builder-request-123',
        }),
        method: 'POST',
      }),
    );
  });
});
