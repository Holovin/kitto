import { describe, expect, it } from 'vitest';
import { shouldExcludeSummaryFromLlmContext } from '../../prompts/openui.js';

describe('shouldExcludeSummaryFromLlmContext', () => {
  it('excludes low-signal assistant summaries', () => {
    expect(shouldExcludeSummaryFromLlmContext('Updated the app.')).toBe(true);
    expect(shouldExcludeSummaryFromLlmContext('Building: Adds a welcome screen…')).toBe(true);
    expect(shouldExcludeSummaryFromLlmContext('The first draft had parser issues, so it was repaired automatically before commit.')).toBe(
      true,
    );
  });

  it('keeps substantive user-facing assistant summaries in LLM context', () => {
    expect(shouldExcludeSummaryFromLlmContext('Adds a compact filter row and preserves the existing layout.')).toBe(false);
  });
});
