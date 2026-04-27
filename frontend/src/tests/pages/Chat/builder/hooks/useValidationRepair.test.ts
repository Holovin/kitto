import { describe, expect, it } from 'vitest';
import type { RawPromptBuildChatHistoryMessage, PromptBuildValidationIssue, BuilderQualityIssue } from '@pages/Chat/builder/types';
import {
  buildRepairChatHistoryWithRejectedDraftNotice,
  dedupeQualityIssues,
  sanitizeRepairValidationIssues,
} from '@pages/Chat/builder/hooks/useValidationRepair';

describe('dedupeQualityIssues', () => {
  it('keeps the first matching quality issue by severity, source, code, statement, and message', () => {
    const duplicateIssue: BuilderQualityIssue = {
      code: 'quality-options-shape',
      message: 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
      severity: 'blocking-quality',
      source: 'quality',
      statementId: 'rickrollOptions',
    };
    const sameCodeDifferentStatement: BuilderQualityIssue = {
      ...duplicateIssue,
      statementId: 'questions',
    };
    const sameCodeDifferentMessage: BuilderQualityIssue = {
      ...duplicateIssue,
      message: 'Collection `questions` contains `.options` arrays with bare strings or numbers.',
    };

    const dedupedIssues = dedupeQualityIssues([
      duplicateIssue,
      { ...duplicateIssue },
      sameCodeDifferentStatement,
      sameCodeDifferentMessage,
    ]);

    expect(dedupedIssues).toEqual([duplicateIssue, sameCodeDifferentStatement, sameCodeDifferentMessage]);
    expect(dedupedIssues[0]).toBe(duplicateIssue);
  });
});

describe('sanitizeRepairValidationIssues', () => {
  it('drops parser suggestions and trims fields to backend request limits', () => {
    const issues: PromptBuildValidationIssue[] = [
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
    const issues: Array<PromptBuildValidationIssue | BuilderQualityIssue> = [
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
        severity: 'blocking-quality',
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
    expect(sanitizedIssues[1]?.severity).toBe('blocking-quality');
    expect(sanitizedIssues[2]?.severity).toBe('blocking-quality');
    expect(sanitizedIssues.slice(3).every((issue) => issue.code === 'unresolved-reference')).toBe(true);
    expect(sanitizedIssues.at(-1)?.statementId).toBe('row-16');
  });

  it('preserves explicit dynamic quality severity in repair payloads', () => {
    const issues: Array<PromptBuildValidationIssue | BuilderQualityIssue> = [
      ...Array.from({ length: 21 }, (_, index) => ({
        code: 'unresolved-reference',
        message: `Missing ref ${index}`,
        source: 'parser' as const,
        statementId: `row-${index}`,
      })),
      {
        code: 'quality-missing-todo-controls',
        message: 'Todo request did not generate required todo controls.',
        severity: 'blocking-quality',
        source: 'quality',
      },
    ];

    const sanitizedIssues = sanitizeRepairValidationIssues(issues, 20);

    expect(sanitizedIssues[0]).toEqual({
      code: 'quality-missing-todo-controls',
      message: 'Todo request did not generate required todo controls.',
      severity: 'blocking-quality',
      source: 'quality',
    });
    expect(sanitizedIssues).toHaveLength(20);
  });

  it('preserves structured undefined-state context and drops unsupported issue context', () => {
    const issues: PromptBuildValidationIssue[] = [
      {
        code: 'undefined-state-reference',
        context: {
          exampleInitializer: '"quiz"',
          refName: ' $currentScreen ',
        },
        message: 'State reference `$currentScreen` is missing a top-level declaration with a literal initial value.',
        source: 'quality',
        statementId: 'root',
      },
      {
        code: 'invalid-prop',
        context: {
          exampleInitializer: '"block"',
          refName: '$direction',
        },
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'root',
      },
      {
        code: 'quality-stale-persisted-query',
        context: {
          statementId: ' addItem ',
          suggestedQueryRefs: [' items ', ''],
        },
        message: 'Persisted mutation may not refresh visible query.',
        source: 'quality',
        statementId: 'addItem',
      },
      {
        code: 'quality-options-shape',
        context: {
          groupId: ' questions ',
          invalidValues: [' Never gonna give you up ', 7],
        },
        message: 'RadioGroup/Select options must be `{label, value}` objects.',
        source: 'quality',
        statementId: 'questions',
      },
      {
        code: 'quality-missing-control-showcase-components',
        context: {
          missingComponents: [' Link ', ''],
        },
        message: 'Control showcase is missing required controls: Link.',
        source: 'quality',
      },
    ];

    expect(sanitizeRepairValidationIssues(issues)).toEqual([
      {
        code: 'invalid-prop',
        message: 'Group.direction must be one of "vertical", "horizontal".',
        source: 'parser',
        statementId: 'root',
      },
      {
        code: 'undefined-state-reference',
        context: {
          exampleInitializer: '"quiz"',
          refName: '$currentScreen',
        },
        message: 'State reference `$currentScreen` is missing a top-level declaration with a literal initial value.',
        severity: 'blocking-quality',
        source: 'quality',
        statementId: 'root',
      },
      {
        code: 'quality-stale-persisted-query',
        context: {
          statementId: 'addItem',
          suggestedQueryRefs: ['items'],
        },
        message: 'Persisted mutation may not refresh visible query.',
        severity: 'blocking-quality',
        source: 'quality',
        statementId: 'addItem',
      },
      {
        code: 'quality-options-shape',
        context: {
          groupId: 'questions',
          invalidValues: [' Never gonna give you up ', 7],
        },
        message: 'RadioGroup/Select options must be `{label, value}` objects.',
        severity: 'blocking-quality',
        source: 'quality',
        statementId: 'questions',
      },
      {
        code: 'quality-missing-control-showcase-components',
        context: {
          missingComponents: ['Link'],
        },
        message: 'Control showcase is missing required controls: Link.',
        severity: 'blocking-quality',
        source: 'quality',
      },
    ]);
  });
});

describe('buildRepairChatHistoryWithRejectedDraftNotice', () => {
  it('appends an assistant repair-memory notice with unique issue codes', () => {
    const chatHistory: RawPromptBuildChatHistoryMessage[] = [
      { role: 'user', content: 'Build a todo app.' },
      { role: 'assistant', content: 'Built a todo app.' },
    ];
    const issues: PromptBuildValidationIssue[] = [
      { code: 'reserved-last-choice-outside-action-mode', message: 'Do not read $lastChoice here.' },
      { code: 'reserved-last-choice-outside-action-mode', message: 'Do not read $lastChoice here either.' },
      { code: 'undefined-state-reference', message: 'Declare $filter first.' },
    ];

    expect(buildRepairChatHistoryWithRejectedDraftNotice(chatHistory, issues)).toEqual([
      ...chatHistory,
      {
        role: 'assistant',
        content: 'Previous draft rejected due to: `reserved-last-choice-outside-action-mode`, `undefined-state-reference`.',
      },
    ]);
    expect(chatHistory).toHaveLength(2);
  });
});
