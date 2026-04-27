import { describe, expect, it } from 'vitest';
import { getBuilderRequestErrorMessage } from '@pages/Chat/builder/api/requestErrors';

describe('getBuilderRequestErrorMessage', () => {
  it('falls back when a FetchBaseQuery error has a non-string error field', () => {
    expect(getBuilderRequestErrorMessage({ status: 'CUSTOM_ERROR', error: { message: 'opaque failure' } })).toBe(
      'The request failed before the builder received a valid response.',
    );
  });
});
