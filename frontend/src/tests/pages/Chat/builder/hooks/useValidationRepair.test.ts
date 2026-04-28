import { describe, expect, it, vi } from 'vitest';
import type {
  BuilderGeneratedDraft,
  BuilderQualityIssue,
  BuilderRequestId,
  PromptBuildRequest,
  PromptBuildValidationIssue,
} from '@pages/Chat/builder/types';
import { toBuilderRequestId } from '@pages/Chat/builder/types';
import type { BuilderRequestLimits } from '@pages/Chat/builder/config';
import {
  dedupeQualityIssues,
  sanitizeRepairValidationIssues,
  useValidationRepair,
} from '@pages/Chat/builder/hooks/useValidationRepair';

const testAppMemory = {
  version: 1 as const,
  appSummary: 'Test app',
  userPreferences: ['Keep the test UI compact.'],
  avoid: [] as string[],
};

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

describe('useValidationRepair', () => {
  it('passes previousSource into generated repair requests when present on the original request', async () => {
    const requestLimits: BuilderRequestLimits = {
      chatMessageMaxChars: 4_096,
      chatHistoryMaxItems: 40,
      promptMaxChars: 4_096,
      requestMaxBytes: 300_000,
      sourceMaxChars: 12_288,
    };
    const request: PromptBuildRequest = {
      prompt: 'Fix an invalid draft.',
      currentSource: 'root = AppShell([Screen("main", "Main", [])])',
      previousSource: 'root = AppShell([Screen("main", "Legacy", [])])',
      chatHistory: [],
      mode: 'initial',
    };
    const runGenerateRequest = vi.fn<
      (
        requestId: BuilderRequestId,
        repairRequest: PromptBuildRequest,
        options?: { requestKind?: 'automatic-repair' | 'stream-fallback'; transportRequestId?: BuilderRequestId },
      ) => Promise<BuilderGeneratedDraft>
    >(async () => {
      return {
        appMemory: testAppMemory,
        changeSummary: 'Test generation change.',
        commitSource: 'fallback',
        requestId: toBuilderRequestId('repair-1'),
        source: 'root = AppShell([Screen("main", "Main", [])])',
        summary: 'Updated the app.',
        qualityIssues: [],
      };
    });
    const validationRepair = useValidationRepair({
      maxRepairAttempts: 2,
      maxRepairValidationIssues: 20,
      requestLimits,
      runGenerateRequest,
      showStreamingSummaryStatus: () => undefined,
      throwIfInactiveRequest: () => undefined,
    });
    const initialResponse: BuilderGeneratedDraft = {
      appMemory: testAppMemory,
      changeSummary: 'Initial generation change.',
      commitSource: 'streaming',
      requestId: toBuilderRequestId('initial'),
      source: 'root = AppShell([',
      summary: 'Updated the app.',
      qualityIssues: [],
    };

    await validationRepair.ensureValidGeneratedSource(initialResponse, request, toBuilderRequestId('initial'));

    expect(runGenerateRequest).toHaveBeenCalledTimes(1);
    expect(runGenerateRequest.mock.calls[0]?.[1]?.previousSource).toBe(request.previousSource);
  });

  it('sends fatal semantic quality issue codes to automatic repair instead of committing', async () => {
    const requestLimits: BuilderRequestLimits = {
      chatMessageMaxChars: 4_096,
      chatHistoryMaxItems: 40,
      promptMaxChars: 4_096,
      requestMaxBytes: 300_000,
      sourceMaxChars: 12_288,
    };
    const request: PromptBuildRequest = {
      prompt: 'Create a small app.',
      currentSource: 'root = AppShell([Screen("main", "Main", [])])',
      chatHistory: [],
      mode: 'initial',
    };
    const runGenerateRequest = vi.fn<
      (
        requestId: BuilderRequestId,
        repairRequest: PromptBuildRequest,
        options?: { requestKind?: 'automatic-repair' | 'stream-fallback'; transportRequestId?: BuilderRequestId },
      ) => Promise<BuilderGeneratedDraft>
    >(async () => ({
      appMemory: testAppMemory,
      changeSummary: 'Fixed duplicate ids.',
      commitSource: 'fallback',
      requestId: toBuilderRequestId('repair-1'),
      source: 'root = AppShell([Screen("main", "Main", [Button("save", "Save", "default", Action([]), false)])])',
      summary: 'Updated the app.',
      qualityIssues: [],
    }));
    const validationRepair = useValidationRepair({
      maxRepairAttempts: 2,
      maxRepairValidationIssues: 20,
      requestLimits,
      runGenerateRequest,
      showStreamingSummaryStatus: () => undefined,
      throwIfInactiveRequest: () => undefined,
    });
    const initialResponse: BuilderGeneratedDraft = {
      appMemory: testAppMemory,
      changeSummary: 'Initial generation change.',
      commitSource: 'streaming',
      requestId: toBuilderRequestId('initial'),
      source: `root = AppShell([
  Screen("main", "Main", [
    Button("save", "Save", "default", Action([]), false),
    Button("save", "Save again", "secondary", Action([]), false)
  ])
])`,
      summary: 'Updated the app.',
      qualityIssues: [],
    };

    const result = await validationRepair.ensureValidGeneratedSource(initialResponse, request, toBuilderRequestId('initial'));

    expect(result.source).toContain('Button("save", "Save"');
    expect(runGenerateRequest).toHaveBeenCalledTimes(1);
    expect(runGenerateRequest.mock.calls[0]?.[1]?.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'duplicate-button-id',
          severity: 'fatal-quality',
          source: 'quality',
        }),
      ]),
    );
  });
});
