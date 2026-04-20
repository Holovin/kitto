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

  it('rejects predicate-form @Filter syntax', () => {
    const result = validateOpenUiSource(`items = [
  { label: "A", completed: true },
  { label: "B", completed: false }
]
visibleItems = @Filter(items, "item", item.completed == true)
rows = @Each(visibleItems, "item", Text(item.label, "body", "start"))
root = AppShell([
  Screen("main", "Items", [Repeater(rows, "No items")])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
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

  it('rejects bare mutation refs used as display values', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Roll", [
    Button("roll-button", "Roll", "default", Action([@Run(rollResult)]), false),
    Text(rollResult == null ? "Нажмите Roll" : "Результат: " + rollResult, "title", "start")
  ])
])

rollResult = Mutation("write_computed_state", {
  path: "app.rollResult",
  op: "random_int",
  options: { min: 1, max: 100 },
  returnType: "number"
})

rollValue = Query("read_state", { path: "app.rollResult" }, null)`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-mutation-reference',
          statementId: 'rollResult',
        }),
      ]),
    );
  });

  it('accepts explicit mutation status/data access when needed', () => {
    const result = validateOpenUiSource(`rollResult = Mutation("write_computed_state", {
  path: "app.rollResult",
  op: "random_int",
  options: { min: 1, max: 100 },
  returnType: "number"
})

root = AppShell([
  Screen("main", "Roll", [
    Button("roll-button", "Roll", "default", Action([@Run(rollResult)]), false),
    Text(rollResult.status == "success" ? "Результат: " + rollResult.data.value : "Нажмите Roll", "title", "start")
  ])
])`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('accepts appearance props on the supported themed components', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Group("Section", "vertical", [
      Text("Hello", "body", "start", { textColor: "#000000" }),
      Input("name", "Name", $name, "Ada", { textColor: "#000000", bgColor: "#FFFFFF" }),
      Button("save", "Save", "default", Action([]), false, { textColor: "#FFFFFF", bgColor: "#111827" }),
      Repeater([], "Empty state", { textColor: "#000000", bgColor: "#FFFFFF" })
    ], "block", { textColor: "#000000", bgColor: "#FFFFFF" })
  ], true, { textColor: "#111827", bgColor: "#FFFFFF" })
], { textColor: "#111827", bgColor: "#FFFFFF" })

$name = "Ada"`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('accepts conditional appearance expressions without treating AST keys as appearance props', () => {
    const result = validateOpenUiSource(`$currentTheme = "light"
root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
], $currentTheme == "dark" ? { textColor: "#F9FAFB", bgColor: "#111827" } : { textColor: "#111827", bgColor: "#FFFFFF" })`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('rejects Text appearance.bgColor because the component only supports textColor', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start", { textColor: "#000000", bgColor: "#111827" })
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Text.appearance.bgColor is not allowed.',
        }),
      ]),
    );
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
    Text("Hello", "body", "start", { textColor: "${invalidColor}" })
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Text.appearance.textColor must be a #RRGGBB hex color.',
        }),
      ]),
    );
  });

  it('rejects invalid Screen appearance colors', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ], true, { textColor: "red", bgColor: "#111827" })
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Screen.appearance.textColor must be a #RRGGBB hex color.',
        }),
      ]),
    );
  });

  it('rejects invalid Screen appearance background colors', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ], true, { textColor: "#F9FAFB", bgColor: "red" })
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Screen.appearance.bgColor must be a #RRGGBB hex color.',
        }),
      ]),
    );
  });

  it('rejects unknown appearance keys', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Button("save", "Save", "default", Action([]), false, { color: "#FFFFFF" })
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Button.appearance.color is not allowed.',
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
