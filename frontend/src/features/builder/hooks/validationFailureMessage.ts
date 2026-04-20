import type { BuilderParseIssue } from '@features/builder/types';

const FAILED_GENERATION_RECOVERY_MESSAGE =
  'An error occurred, a new version was not created. Please try rephrasing your request and run it again.';

function formatValidationIssue(issue: BuilderParseIssue) {
  return `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}: ${issue.message}`;
}

export function createValidationFailureMessage(issues: BuilderParseIssue[], maxAutoRepairAttempts: number) {
  const summary = issues.slice(0, 3).map(formatValidationIssue).join(' | ');
  const repairAttemptLabel =
    maxAutoRepairAttempts === 1 ? '1 automatic repair attempt' : `${maxAutoRepairAttempts} automatic repair attempts`;

  return `The model kept returning invalid OpenUI after ${repairAttemptLabel}. ${summary || 'Please try again.'}\n\n${FAILED_GENERATION_RECOVERY_MESSAGE}`;
}
