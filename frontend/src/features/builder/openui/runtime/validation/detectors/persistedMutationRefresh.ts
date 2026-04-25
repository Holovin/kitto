import type { ParseResult } from '@openuidev/react-lang';
import type { BuilderParseIssue } from '@features/builder/types';
import {
  collectActionRunRefGroups,
  collectPersistedQueryRefs,
  collectRefreshablePersistedMutationPaths,
  createQualityIssue,
  doPathsOverlapByPrefix,
} from '@features/builder/openui/runtime/validation/shared';

const REFRESHABLE_PERSISTED_MUTATION_TOOL_NAMES = new Set([
  'append_state',
  'append_item',
  'merge_state',
  'remove_item',
  'remove_state',
  'toggle_item_field',
  'update_item_field',
  'write_computed_state',
  'write_state',
]);

export function detectPersistedMutationRefreshWarnings(result: ParseResult): BuilderParseIssue[] {
  if (result.meta.incomplete || !result.root) {
    return [];
  }

  const mutationPathByStatementId = collectRefreshablePersistedMutationPaths(result, REFRESHABLE_PERSISTED_MUTATION_TOOL_NAMES);
  const persistedQueryRefs = collectPersistedQueryRefs(result);

  if (mutationPathByStatementId.size === 0 || persistedQueryRefs.length === 0) {
    return [];
  }

  const warnings: BuilderParseIssue[] = [];
  const seenWarningKeys = new Set<string>();

  for (const actionRunRefs of collectActionRunRefGroups(result.root)) {
    for (const [index, runRef] of actionRunRefs.entries()) {
      if (runRef.refType !== 'mutation') {
        continue;
      }

      const path = mutationPathByStatementId.get(runRef.statementId);
      const matchingQueryIds = path
        ? persistedQueryRefs.filter((queryRef) => doPathsOverlapByPrefix(path, queryRef.path)).map((queryRef) => queryRef.statementId)
        : [];
      const laterQueryRunIds = new Set(
        actionRunRefs.slice(index + 1).filter((ref) => ref.refType === 'query').map((ref) => ref.statementId),
      );

      if (!path || matchingQueryIds.length === 0 || matchingQueryIds.some((statementId) => laterQueryRunIds.has(statementId))) {
        continue;
      }

      const warningKey = `${runRef.statementId}:${path}`;

      if (seenWarningKeys.has(warningKey)) {
        continue;
      }

      seenWarningKeys.add(warningKey);
      warnings.push(
        createQualityIssue({
          code: 'quality-stale-persisted-query',
          context: {
            statementId: runRef.statementId,
            suggestedQueryRefs: matchingQueryIds,
          },
          message: `Persisted mutation may not refresh visible query. After @Run(${runRef.statementId}), also run ${matchingQueryIds
            .map((statementId) => `@Run(${statementId})`)
            .join(' or ')} later in the same Action for affected path "${path}".`,
          statementId: runRef.statementId,
        }),
      );
    }
  }

  return warnings;
}
