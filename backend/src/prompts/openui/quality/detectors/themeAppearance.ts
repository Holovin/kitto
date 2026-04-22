import type { ParseResult } from '@openuidev/lang-core';
import type { PromptBuildValidationIssue } from '../../types.js';
import {
  collectThemeAppearanceRefNames,
  createQualityIssue,
  hasThemeDependentContainerAppearance,
} from '../shared.js';

export function detectThemeAppearanceIssues(source: string, result: ParseResult): PromptBuildValidationIssue[] {
  if (result.meta.incomplete || !result.root) {
    return [];
  }

  const themeStateNames = collectThemeAppearanceRefNames(source);

  if (themeStateNames.size > 0 && hasThemeDependentContainerAppearance(result.root, themeStateNames)) {
    return [];
  }

  return [
    createQualityIssue({
      code: 'quality-theme-state-not-applied',
      message:
        'Theme-switch request did not wire theme state into container appearance. Bind AppShell or a top-level container appearance to a theme state such as `$currentTheme` so switching theme changes colors.',
    }),
  ];
}
