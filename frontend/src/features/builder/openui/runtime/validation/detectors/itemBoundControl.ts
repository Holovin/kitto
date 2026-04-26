import { findFunctionCalls, parseStringLiteralValue } from '@kitto-openui/shared/openuiSourceParsing.js';
import { createOpenUiQualityIssue, escapeRegExp, maskStringLiterals, type OpenUiQualityIssue } from '@features/builder/openui/runtime/validation/shared';

const ITEM_SCOPED_CONTROL_TYPE_NAMES = new Set(['Checkbox', 'Input', 'RadioGroup', 'Select', 'TextArea']);

function getItemScopedControlArgIndexes(typeName: string) {
  if (typeName === 'Checkbox') {
    return {
      action: 5,
      binding: 2,
      name: 0,
    };
  }

  if (typeName === 'Input' || typeName === 'TextArea') {
    return {
      action: null,
      binding: 2,
      name: 0,
    };
  }

  if (typeName === 'RadioGroup' || typeName === 'Select') {
    return {
      action: 6,
      binding: 2,
      name: 0,
    };
  }

  return null;
}

function sourceReferencesItemField(expressionSource: string, itemAlias: string) {
  if (!expressionSource.trim()) {
    return false;
  }

  return new RegExp(`(?<![\\w$])${escapeRegExp(itemAlias)}\\.[A-Za-z_][\\w-]*\\b`).test(maskStringLiterals(expressionSource));
}

export function detectItemBoundControlsWithoutAction(source: string): OpenUiQualityIssue[] {
  const issues: OpenUiQualityIssue[] = [];
  const seenIssueKeys = new Set<string>();

  for (const eachCall of findFunctionCalls(source, 'Each')) {
    const collectionLabel = eachCall.args[0]?.trim() || 'the repeated collection';
    const itemAlias = parseStringLiteralValue(eachCall.args[1] ?? '') ?? 'item';
    const rowSource = eachCall.args[2] ?? '';

    for (const controlTypeName of ITEM_SCOPED_CONTROL_TYPE_NAMES) {
      const argIndexes = getItemScopedControlArgIndexes(controlTypeName);

      if (!argIndexes) {
        continue;
      }

      for (const controlCall of findFunctionCalls(rowSource, controlTypeName)) {
        const nameSource = controlCall.args[argIndexes.name] ?? '';
        const bindingSource = controlCall.args[argIndexes.binding] ?? '';
        const actionSource = argIndexes.action == null ? '' : (controlCall.args[argIndexes.action] ?? '');
        const hasAction = actionSource.trim() !== '' && actionSource.trim() !== 'null';

        if (
          hasAction ||
          (!sourceReferencesItemField(nameSource, itemAlias) && !sourceReferencesItemField(bindingSource, itemAlias))
        ) {
          continue;
        }

        const issueKey = `${controlTypeName}:${collectionLabel}:${controlCall.text}`;

        if (seenIssueKeys.has(issueKey)) {
          continue;
        }

        seenIssueKeys.add(issueKey);
        issues.push(
          createOpenUiQualityIssue('blocking-quality', {
            code: 'item-bound-control-without-action',
            message: `Item-scoped control without \`action\` will not persist changes back to \`${collectionLabel}\`. Use action-mode with \`toggle_item_field\` / \`update_item_field\`.`,
          }),
        );
      }
    }
  }

  return issues;
}
