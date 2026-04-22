import { describe, expect, it } from 'vitest';
import type { BuilderParseIssue, BuilderQualityIssue } from '@features/builder/types';
import { resolveLocalAutoFixes, sanitizeRepairValidationIssues } from '@features/builder/hooks/useValidationRepair';

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

describe('resolveLocalAutoFixes', () => {
  it('stops when local auto-fixes oscillate between previously seen sources', () => {
    const issue: BuilderParseIssue = {
      code: 'invalid-args',
      message: 'Oscillating local fix.',
      source: 'parser',
    };

    const result = resolveLocalAutoFixes('A', {
      applyIssueSuggestions: (source, issues) => ({
        appliedIssues: issues,
        source: source === 'A' ? 'B' : 'A',
      }),
      maxPasses: 5,
      validateSource: (source) => ({
        isValid: false,
        issues: [{ ...issue, statementId: source }],
      }),
    });

    expect(result.status).toBe('loop-detected');
    expect(result.source).toBe('A');
    expect(result.appliedIssues).toHaveLength(2);
    expect(result.validation.isValid).toBe(false);
  });

  it('caps local auto-fix passes when each pass keeps changing the source without converging', () => {
    const issue: BuilderParseIssue = {
      code: 'invalid-args',
      message: 'Still invalid.',
      source: 'parser',
    };

    const result = resolveLocalAutoFixes('A', {
      applyIssueSuggestions: (source, issues) => ({
        appliedIssues: issues,
        source: `${source}!`,
      }),
      maxPasses: 2,
      validateSource: () => ({
        isValid: false,
        issues: [issue],
      }),
    });

    expect(result.status).toBe('max-passes');
    expect(result.source).toBe('A!!');
    expect(result.appliedIssues).toHaveLength(2);
    expect(result.validation.isValid).toBe(false);
  });

  it('returns the converged valid source when built-in local suggestions can fully repair it', () => {
    const invalidSource = `root = AppShell({ mainColor: "#FFFFFF", contrastColor: "#111827" }, [
  Screen("main", "Main", [
    Group("Filters", [
      Button("save", "Save", "default", Action([]), false, { textColor: "#FFFFFF", bgColor: "#111827" })
    ], "block")
  ]),
  Screen("settings", "Settings")
])`;

    const result = resolveLocalAutoFixes(invalidSource);

    expect(result.status).toBe('valid');
    expect(result.source).not.toBe(invalidSource);
    expect(result.appliedIssues.length).toBeGreaterThanOrEqual(4);
    expect(result.validation).toEqual({
      isValid: true,
      issues: [],
    });
  });
});
