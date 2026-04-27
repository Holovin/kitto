import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestId } from '@pages/Chat/builder/api/requestId';

describe('createRequestId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID for request ids', () => {
    const randomUUID = vi.fn(() => 'request-uuid');

    vi.stubGlobal('crypto', { randomUUID });

    expect(createRequestId()).toBe('request-uuid');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});
