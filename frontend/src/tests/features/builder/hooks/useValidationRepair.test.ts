import { describe, expect, it } from 'vitest';
import type { BuilderParseIssue } from '@features/builder/types';
import { sanitizeRepairValidationIssues } from '@features/builder/hooks/useValidationRepair';

describe('sanitizeRepairValidationIssues', () => {
  it('drops parser suggestions and trims fields to backend request limits', () => {
    const issues: BuilderParseIssue[] = [
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'x'.repeat(250),
        suggestion: {
          kind: 'replace-text',
          from: 'x'.repeat(1_500),
          to: 'y'.repeat(1_500),
        },
      },
      {
        code: 'unresolved-reference',
        message: 'm'.repeat(2_100),
        source: 'parser',
        statementId: 'items',
      },
    ];

    expect(sanitizeRepairValidationIssues(issues)).toEqual([
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: `${'x'.repeat(199)}…`,
      },
      {
        code: 'unresolved-reference',
        message: `${'m'.repeat(1_999)}…`,
        source: 'parser',
        statementId: 'items',
      },
    ]);
    expect(issues[0]?.suggestion).toEqual({
      kind: 'replace-text',
      from: 'x'.repeat(1_500),
      to: 'y'.repeat(1_500),
    });
  });
});
