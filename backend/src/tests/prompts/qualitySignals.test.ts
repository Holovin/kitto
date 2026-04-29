import { describe, expect, it } from 'vitest';
import {
  promptRequestsCompute,
  promptRequestsThemeOrVisualStyling,
  promptRequestsVisualStyling,
} from '#backend/prompts/openui/qualitySignals.js';

describe('promptRequestsVisualStyling', () => {
  it.each([
    'rule',
    'business rules',
    'show color',
    'show color values',
    'styled task rules',
    'show the palette values as text',
  ])('does not treat "%s" as a visual styling request', (prompt) => {
    expect(promptRequestsVisualStyling(prompt)).toBe(false);
  });

  it.each([
    'use a color scheme',
    'set background color',
    'dark interface',
    'apply a visual style',
    'use styling for the buttons',
    'set an accent color',
  ])('treats "%s" as a visual styling request', (prompt) => {
    expect(promptRequestsVisualStyling(prompt)).toBe(true);
  });
});

describe('promptRequestsThemeOrVisualStyling', () => {
  it.each(['dark theme', 'light mode', 'theme toggle', 'use a color palette'])(
    'treats "%s" as a theme or visual styling request',
    (prompt) => {
      expect(promptRequestsThemeOrVisualStyling(prompt)).toBe(true);
    },
  );
});

describe('promptRequestsCompute', () => {
  it.each(['business rules', 'calculate business rules', 'show calculation rules'])(
    'does not treat "%s" as a compute request',
    (prompt) => {
      expect(promptRequestsCompute(prompt)).toBe(false);
    },
  );

  it.each(['calculate totals', 'calculate the score', 'compare dates', 'build a calculator'])(
    'treats "%s" as a compute request',
    (prompt) => {
      expect(promptRequestsCompute(prompt)).toBe(true);
    },
  );
});
