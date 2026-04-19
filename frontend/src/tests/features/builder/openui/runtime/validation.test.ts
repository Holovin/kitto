import { describe, expect, it } from 'vitest';
import { validateOpenUiSource } from '@features/builder/openui/runtime/validation';

const validSource = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;

describe('validateOpenUiSource', () => {
  it('rejects empty source', () => {
    const result = validateOpenUiSource('   ');

    expect(result).toEqual({
      isValid: false,
      issues: [
        expect.objectContaining({
          code: 'empty-source',
          message: 'The model returned an empty OpenUI document.',
          source: 'parser',
        }),
      ],
    });
  });

  it('rejects source without a renderable root', () => {
    const result = validateOpenUiSource('Screen("main", "Main", [])');

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-root',
        }),
      ]),
    );
  });

  it('rejects markdown code fences', () => {
    const result = validateOpenUiSource(`\`\`\`\n${validSource}\n\`\`\``);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'code-fence-present',
        }),
      ]),
    );
  });

  it('accepts a valid OpenUI document', () => {
    const result = validateOpenUiSource(validSource);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('rejects unknown components inside an otherwise valid document', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    UnknownComponent([])
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects unsafe source patterns', () => {
    const result = validateOpenUiSource(`${validSource}\nText("<script>alert(1)</script>", "body", "start")`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsafe-pattern',
        }),
      ]),
    );
  });

  it('rejects query and mutation tool names outside the allowlist', () => {
    const result = validateOpenUiSource(`items = Query("fetch_state", { path: "app.items" }, [])
saveItem = Mutation("delete_state", { path: "app.items", index: 0 })
${validSource}`);

    expect(result.isValid).toBe(false);
    expect(result.issues.filter((issue) => issue.code === 'unknown-tool')).toHaveLength(2);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unknown-tool',
          message: 'Tool "fetch_state" is not allowed.',
        }),
        expect.objectContaining({
          code: 'unknown-tool',
          message: 'Tool "delete_state" is not allowed.',
        }),
      ]),
    );
  });

  it('rejects source above the configured size limit', () => {
    const oversizedSource = `root = AppShell([
  Screen("main", "Main", [
    Text("${'A'.repeat(50_100)}", "body", "start")
  ])
])`;

    const result = validateOpenUiSource(oversizedSource);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'source-too-large',
        }),
      ]),
    );
  });
});
