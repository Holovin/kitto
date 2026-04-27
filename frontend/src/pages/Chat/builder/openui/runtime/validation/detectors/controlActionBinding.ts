import { visitOpenUiValue } from '@pages/Chat/builder/openui/runtime/validation/astWalk';
import {
  createOpenUiQualityIssue,
  isElementNode,
  isWritableBindingValue,
  type BuilderQualityIssue,
} from '@pages/Chat/builder/openui/runtime/validation/shared';

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
