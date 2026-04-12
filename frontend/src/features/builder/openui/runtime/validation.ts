import { createParser } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import type { BuilderParseIssue } from '@features/builder/types';

const parser = createParser(builderOpenUiLibrary.toJSONSchema(), 'AppShell');

export interface OpenUiValidationResult {
  isValid: boolean;
  issues: BuilderParseIssue[];
}

export function validateOpenUiSource(source: string): OpenUiValidationResult {
  const trimmedSource = typeof source === 'string' ? source.trim() : '';

  if (!trimmedSource) {
    return {
      isValid: false,
      issues: [
        {
          code: 'empty-source',
          message: 'The model returned an empty OpenUI document.',
          source: 'parser',
        },
      ],
    };
  }

  const result = parser.parse(trimmedSource);
  const issues: BuilderParseIssue[] = result.meta.errors.map((error) => ({
    code: error.code,
    message: error.message,
    statementId: error.statementId,
    source: 'parser',
  }));

  if (!result.meta.incomplete) {
    issues.push(
      ...result.meta.unresolved.map((statementId) => ({
        code: 'unresolved-reference',
        message: 'This statement was referenced but never defined in the final source.',
        statementId,
        source: 'parser' as const,
      })),
    );
  }

  if (!result.root) {
    issues.push({
      code: 'missing-root',
      message: 'The final program does not define a renderable root = AppShell(...).',
      source: 'parser',
    });
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}
