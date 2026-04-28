import { describe, expect, it } from 'vitest';
import {
  buildContextMeterSections,
  formatContextMeterTooltip,
} from '@pages/Chat/builder/hooks/generationContext';

describe('generationContext', () => {
  it('marks current source as protected in the context meter', () => {
    const currentSource = 'root = AppShell([])';
    const sections = buildContextMeterSections({
      appMemory: {
        version: 1,
        appSummary: 'Test app',
        userPreferences: [],
        avoid: [],
      },
      currentSource,
      latestUserPrompt: 'Add a settings screen.',
      previousChangeSummaries: ['Created the app.'],
      previousUserMessages: ['Create an app.'],
    });

    expect(sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chars: currentSource.length,
          included: true,
          name: 'currentSource',
          protected: true,
          reason: 'protected',
        }),
      ]),
    );
    expect(formatContextMeterTooltip(sections)).toContain(`- currentSource: ${currentSource.length} chars protected`);
  });
});
