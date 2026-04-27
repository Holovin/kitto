import type { ParseResult } from '@openuidev/lang-core';
import type { PromptBuildValidationIssue } from '#backend/prompts/openui/types.js';
import {
  collectActionRunRefGroups,
  collectPersistedQueryRefs,
  createQualityIssue,
  doPathsOverlapByPrefix,
  extractObjectStringLiteral,
  extractPathLiteral,
  extractStringLiteral,
  type PersistedPathStatementRef,
} from '#backend/prompts/openui/quality/shared.js';

export function detectRandomResultVisibilityIssues(result: ParseResult): PromptBuildValidationIssue[] {
  if (result.meta.incomplete || !result.root) {
    return [];
  }

  const persistedQueryRefs = collectPersistedQueryRefs(result);
  const actionRunRefGroups = collectActionRunRefGroups(result.root);
  const randomMutations = result.mutationStatements.flatMap((mutation) => {
    const toolName = extractStringLiteral(mutation.toolAST);
    const path = extractPathLiteral(mutation.argsAST);
    const op = extractObjectStringLiteral(mutation.argsAST, 'op');

    if (toolName !== 'write_computed_state' || op !== 'random_int' || !path) {
      return [];
    }

    return [{ path, statementId: mutation.statementId } satisfies PersistedPathStatementRef];
  });

  let hasRandomResultNotVisible = false;

  for (const randomMutation of randomMutations) {
    const matchingQueryIds = persistedQueryRefs
      .filter((queryRef) => doPathsOverlapByPrefix(randomMutation.path, queryRef.path))
      .map((queryRef) => queryRef.statementId);

    if (matchingQueryIds.length === 0) {
      continue;
    }

    const hasVisibleRefreshAction = actionRunRefGroups.some((actionRunRefs) =>
      actionRunRefs.some(
        (runRef, index) =>
          runRef.refType === 'mutation' &&
          runRef.statementId === randomMutation.statementId &&
          actionRunRefs
            .slice(index + 1)
            .some((laterRunRef) => laterRunRef.refType === 'query' && matchingQueryIds.includes(laterRunRef.statementId)),
      ),
    );

    hasRandomResultNotVisible ||= !hasVisibleRefreshAction;
  }

  if (!hasRandomResultNotVisible) {
    return [];
  }

  return [
    createQualityIssue({
      code: 'quality-random-result-not-visible',
      message:
        'Random result cannot become visible. Use a `Mutation("write_computed_state", ...)`, a matching `Query("read_state", { path: "..." }, defaultValue)`, and a button `Action(...)` that runs both.',
    }),
  ];
}
