import type { PromptBuildValidationIssue } from '@features/builder/types';

function formatValidationIssue(issue: PromptBuildValidationIssue) {
  return `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}: ${issue.message}`;
}

export function createValidationFailureMessage(issues: PromptBuildValidationIssue[], maxAutoRepairAttempts: number) {
  const summary = issues.slice(0, 3).map(formatValidationIssue).join(' | ');
  const repairAttemptLabel =
    maxAutoRepairAttempts <= 0
      ? 'without an automatic repair attempt'
      : maxAutoRepairAttempts === 1
        ? 'after 1 automatic repair attempt'
        : `after ${maxAutoRepairAttempts} automatic repair attempts`;

  return `The model kept returning draft issues ${repairAttemptLabel}. ${summary || 'Please try again.'}`;
}
