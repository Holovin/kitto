import type { BuilderQualityIssue, PromptBuildValidationIssue } from './builderApiContract.js';
import {
  doPathsOverlapByPrefix,
  isElementNode,
  isWritableBindingValue,
  type OpenUiParseResultLike,
  type OpenUiProgramIndex,
  visitOpenUiValue,
} from './openuiAst.js';

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

function createQualityIssue(issue: Omit<PromptBuildValidationIssue, 'source'>): PromptBuildValidationIssue {
  return {
    ...issue,
    source: 'quality',
  };
}

function createOpenUiQualityIssue(
  severity: BuilderQualityIssue['severity'],
  issue: Omit<PromptBuildValidationIssue, 'source'>,
): BuilderQualityIssue {
  return {
    ...issue,
    severity,
    source: 'quality',
  };
}

export function detectControlActionBindingConflicts(value: unknown): BuilderQualityIssue[] {
  const issues: BuilderQualityIssue[] = [];

  visitOpenUiValue(value, (node, context) => {
    if (!isElementNode(node)) {
      return;
    }

    if (
      node.props.action != null &&
      ((node.typeName === 'Checkbox' && isWritableBindingValue(node.props.checked)) ||
        ((node.typeName === 'RadioGroup' || node.typeName === 'Select') && isWritableBindingValue(node.props.value)))
    ) {
      issues.push(
        createOpenUiQualityIssue('blocking-quality', {
          code: 'control-action-and-binding',
          message:
            'Form-control cannot have both action and a writable $binding. Use $binding for form state, or action for persisted updates.',
          statementId: context.statementId,
        }),
      );
    }
  });

  return issues;
}

export function detectPersistedMutationRefreshWarnings(
  result: OpenUiParseResultLike & { meta?: { incomplete?: boolean } },
  programIndex: OpenUiProgramIndex,
): PromptBuildValidationIssue[] {
  if (result.meta?.incomplete || !result.root) {
    return [];
  }

  const mutationPathByStatementId = new Map(
    programIndex.mutationToolRefs
      .filter((mutation) => REFRESHABLE_PERSISTED_MUTATION_TOOL_NAMES.has(mutation.toolName))
      .map((mutation) => [mutation.statementId, mutation.path]),
  );
  const persistedQueryRefs = programIndex.persistedQueryRefs;

  if (mutationPathByStatementId.size === 0 || persistedQueryRefs.length === 0) {
    return [];
  }

  const warnings: PromptBuildValidationIssue[] = [];
  const seenWarningKeys = new Set<string>();

  for (const actionRunRefs of programIndex.actionRunRefGroups) {
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
