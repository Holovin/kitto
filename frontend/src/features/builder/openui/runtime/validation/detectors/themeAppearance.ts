import type { ParseResult } from '@openuidev/react-lang';
import type { BuilderParseIssue } from '@features/builder/types';
import {
  collectThemeAppearanceRefNames,
  createQualityIssue,
  hasThemeDependentContainerAppearance,
} from '../shared';

export function detectThemeAppearanceIssues(source: string, result: ParseResult): BuilderParseIssue[] {
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
        'Theme request did not wire theme state into container appearance. Bind AppShell or a top-level container appearance to a theme state such as `$currentTheme` so switching theme changes colors.',
    }),
  ];
}
