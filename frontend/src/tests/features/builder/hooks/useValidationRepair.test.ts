import { describe, expect, it } from 'vitest';
import type { BuilderParseIssue, BuilderQualityIssue } from '@features/builder/types';
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

  it('prioritizes root-cause issues before slicing repair payloads to the backend limit', () => {
    const issues: Array<BuilderParseIssue | BuilderQualityIssue> = [
      ...Array.from({ length: 27 }, (_, index) => ({
        code: 'unresolved-reference',
        message: `Missing ref ${index}`,
        source: 'parser' as const,
        statementId: `row-${index}`,
      })),
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'root',
      },
      {
        code: 'control-action-and-binding',
        message: 'Form-control cannot have both action and a writable $binding.',
        severity: 'blocking-quality',
        source: 'quality',
        statementId: 'settings',
      },
      {
        code: 'inline-tool-in-prop',
        message: 'Mutation(...) and Query(...) must be top-level statements.',
        source: 'quality',
        statementId: 'items',
      },
    ];

    const sanitizedIssues = sanitizeRepairValidationIssues(issues, 20);

    expect(sanitizedIssues).toHaveLength(20);
    expect(sanitizedIssues.slice(0, 3).map((issue) => issue.code)).toEqual([
      'invalid-prop',
      'control-action-and-binding',
      'inline-tool-in-prop',
    ]);
    expect(sanitizedIssues.slice(3).every((issue) => issue.code === 'unresolved-reference')).toBe(true);
    expect(sanitizedIssues.at(-1)?.statementId).toBe('row-16');
    expect(sanitizedIssues.some((issue) => 'severity' in issue)).toBe(false);
  });
});
