import { BUILDER_DEMO_PRESETS } from '@pages/Chat/builder/openui/runtime/demos';
import {
  detectLocalRuntimeQualityIssues,
  validateOpenUiSource,
} from '@pages/Chat/builder/openui/runtime/validation';
import { ELEMENT_DEMO_DEFINITIONS } from '@pages/Elements/elementDemos';
import { describe, expect, it } from 'vitest';

describe('structural OpenUI invariants', () => {
  it('rejects AppShell nested outside the root statement', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Group("Nested shell", "vertical", [
      AppShell([])
    ])
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'app-shell-not-root',
          source: 'quality',
        }),
      ]),
    );
  });

  it('rejects multiple AppShell statements in one document', () => {
    const result = validateOpenUiSource(`shell = AppShell([])
root = AppShell([
  Screen("main", "Main", [])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'multiple-app-shells',
          source: 'quality',
          statementId: 'root',
        }),
      ]),
    );
  });

  it('rejects Screen nested inside another Screen at any depth', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Group("Body", "vertical", [
      Screen("details", "Details", [
        Text("Nested", "body", "start")
      ])
    ])
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'screen-inside-screen',
          source: 'quality',
          statementId: 'root',
        }),
      ]),
    );
  });

  it('rejects Repeater nested inside another Repeater, including row templates', () => {
    const result = validateOpenUiSource(`items = [
  { label: "Parent row" }
]
rows = @Each(items, "item", Group(null, "vertical", [
  Text(item.label, "body", "start"),
  Repeater([], "Nested")
], "block"))

root = AppShell([
  Screen("main", "Main", [
    Repeater(rows, "No items")
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'repeater-inside-repeater',
          source: 'quality',
          statementId: 'root',
        }),
      ]),
    );
  });

  it('allows Group nesting and Groups inside Repeater rows', () => {
    const result = validateOpenUiSource(`items = [
  { label: "Alpha" }
]
rows = @Each(items, "item", Group(null, "vertical", [
  Group(null, "horizontal", [
    Text(item.label, "body", "start")
  ], "inline")
], "block"))

root = AppShell([
  Screen("main", "Main", [
    Group("Outer", "vertical", [
      Group("Inner", "horizontal", [
        Text("Hello", "body", "start")
      ], "inline")
    ]),
    Repeater(rows, "No items")
  ])
])`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('surfaces structural nesting violations as fatal quality issues', () => {
    const issues = detectLocalRuntimeQualityIssues(`root = AppShell([
  Screen("main", "Main", [
    Group("Body", "vertical", [
      Screen("details", "Details", [])
    ])
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'screen-inside-screen',
          severity: 'fatal-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('keeps current builder and /elements demos valid', () => {
    const invalidDemos = [
      ...BUILDER_DEMO_PRESETS.map((demo) => ({ id: demo.id, source: demo.source })),
      ...Object.entries(ELEMENT_DEMO_DEFINITIONS).map(([id, demo]) => ({ id, source: demo.source })),
    ]
      .map(({ id, source }) => ({
        id,
        validation: validateOpenUiSource(source),
      }))
      .filter(({ validation }) => !validation.isValid)
      .map(({ id, validation }) => ({
        id,
        issues: validation.issues.map((issue) => issue.code),
      }));

    expect(invalidDemos).toEqual([]);
  });
});
