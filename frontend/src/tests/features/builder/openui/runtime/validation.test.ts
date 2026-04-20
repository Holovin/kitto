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

  it('rejects incomplete or truncated source', () => {
    const result = validateOpenUiSource('root = AppShell([');

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'incomplete-source',
          message: 'The OpenUI source is incomplete or truncated.',
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

  it('accepts filtered collections, counts, and @Each templates over derived rows', () => {
    const result = validateOpenUiSource(`items = [
  { title: "Write tests", completed: true },
  { title: "Ship changes", completed: false }
]
filteredItems = @Filter(items, "completed", "==", true)
filteredCount = @Count(filteredItems)
rows = @Each(filteredItems, "item", Group(null, "vertical", [
  Text(item.title, "body", "start")
]))
root = AppShell([
  Screen("main", "Main", [
    Text("Completed: " + filteredCount, "body", "start"),
    Repeater(rows, "No completed items.")
  ])
])`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('accepts expressions directly inside the @Each source argument', () => {
    const result = validateOpenUiSource(`$filter = "completed"
items = [
  { title: "Write tests", completed: true },
  { title: "Ship changes", completed: false }
]
rows = @Each($filter == "completed" ? @Filter(items, "completed", "==", true) : items, "item", Group(null, "vertical", [
  Text(item.title, "body", "start")
]))
root = AppShell([
  Screen("main", "Main", [
    Text("Visible: " + @Count(@Filter(items, "completed", "==", true)), "body", "start"),
    Repeater(rows, "Nothing to show.")
  ])
])`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('accepts safe compute tools and .value access for object query results', () => {
    const result = validateOpenUiSource(`$name = ""
nameValid = Query("compute_value", {
  op: "not_empty",
  input: $name,
  returnType: "boolean"
}, { value: false })
rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 6 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)
root = AppShell([
  Screen("main", "Main", [
    Text(nameValid.value ? "Ready" : "Name required", "body", "start"),
    Button("roll", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false),
    Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
  ])
])`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it.each(['#000000', '#FFFFFF'])('accepts strict hex color prop %s', (hexColor) => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start", "${hexColor}")
  ], true, "#F9FAFB", "#111827")
])`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('rejects Text background because the component no longer supports it', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start", "#000000", "#111827")
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
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

  it('rejects invalid Group variants', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Group("Filters", "horizontal", [
      Text("Pending", "body", "start")
    ], "card")
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it.each([
    '#fff',
    'red',
    'rgb(0,0,0)',
    'var(--x)',
    'url(...)',
  ])('rejects invalid visual color prop %s', (invalidColor) => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start", "${invalidColor}")
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Text.color must be a #RRGGBB hex color.',
        }),
      ]),
    );
  });

  it('rejects invalid Screen title colors', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ], true, "red", "#111827")
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Screen.color must be a #RRGGBB hex color.',
        }),
      ]),
    );
  });

  it('rejects invalid Screen background colors', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ], true, "#F9FAFB", "red")
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Screen.background must be a #RRGGBB hex color.',
        }),
      ]),
    );
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
