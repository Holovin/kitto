import type { ParseResult } from '@openuidev/lang-core';
import type { PromptBuildValidationIssue } from '#backend/prompts/openui/types.js';
import {
  collectThemeAppearanceRefNamesFromStatements,
  createQualityIssue,
  hasThemeDependentContainerAppearance,
  type OpenUiProgramIndex,
} from '#backend/prompts/openui/quality/shared.js';

export function detectThemeAppearanceIssues(result: ParseResult, programIndex: OpenUiProgramIndex): PromptBuildValidationIssue[] {
  if (result.meta.incomplete || !result.root) {
    return [];
  }

  const themeStateNames = collectThemeAppearanceRefNamesFromStatements(programIndex.topLevelStatements);

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
