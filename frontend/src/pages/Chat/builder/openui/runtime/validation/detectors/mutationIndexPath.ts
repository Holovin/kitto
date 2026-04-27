import type { ParseResult } from '@openuidev/react-lang';
import {
  createOpenUiQualityIssue,
  extractPathLiteral,
  extractStringLiteral,
  pathUsesArrayIndexSegment,
  type BuilderQualityIssue,
} from '@pages/Chat/builder/openui/runtime/validation/shared';

const ARRAY_INDEX_PATH_MUTATION_TOOL_NAMES = new Set(['merge_state', 'remove_state', 'write_state']);

export function detectArrayIndexPathMutationIssues(result: ParseResult): BuilderQualityIssue[] {
  return result.mutationStatements.flatMap((mutation) => {
    const toolName = extractStringLiteral(mutation.toolAST);
    const path = extractPathLiteral(mutation.argsAST);

    if (!toolName || !path || !ARRAY_INDEX_PATH_MUTATION_TOOL_NAMES.has(toolName) || !pathUsesArrayIndexSegment(path)) {
      return [];
    }

    return [
      createOpenUiQualityIssue('blocking-quality', {
        code: 'mutation-uses-array-index-path',
        message:
          'Mutating array elements by index is fragile. Use `toggle_item_field`, `update_item_field`, or `remove_item` with `idField`+`id`.',
        statementId: mutation.statementId,
      }),
    ];
  });
}
