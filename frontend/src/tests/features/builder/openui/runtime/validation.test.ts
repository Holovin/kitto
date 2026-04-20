import { describe, expect, it } from 'vitest';
import { detectOpenUiQualityWarnings, validateOpenUiSource } from '@features/builder/openui/runtime/validation';

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

  it('accepts typed inputs and declarative validation examples', () => {
    const result = validateOpenUiSource(`$dueDate = ""
$email = ""
$quantity = ""
$agreement = false

root = AppShell([
  Screen("main", "Main", [
    Input("dueDate", "Due date", $dueDate, "", "Pick a due date", "date", [
      { type: "required", message: "Choose a due date" }
    ]),
    Input("email", "Email", $email, "name@example.com", "Enter email", "email", [
      { type: "required", message: "Email is required" },
      { type: "email", message: "Enter a valid email" }
    ]),
    Input("quantity", "Quantity", $quantity, "1", "Enter quantity", "number", [
      { type: "required", message: "Quantity is required" },
      { type: "minNumber", value: 1, message: "Must be at least 1" },
      { type: "maxNumber", value: 10, message: "Must be no more than 10" }
    ]),
    Checkbox("agreement", "I agree to continue", $agreement, null, [
      { type: "required", message: "You must agree before continuing" }
    ])
  ])
])`);

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
      Text("Hello", "body", "start", { contrastColor: "#000000" }),
      Input("name", "Name", $name, "Ada", null, "text", [], { mainColor: "#FFFFFF", contrastColor: "#000000" }),
      Button("save", "Save", "default", Action([]), false, { mainColor: "#FFFFFF", contrastColor: "#111827" }),
      Repeater([], "Empty state", { mainColor: "#FFFFFF", contrastColor: "#000000" })
    ], "block", { mainColor: "#FFFFFF", contrastColor: "#000000" })
  ], true, { mainColor: "#FFFFFF", contrastColor: "#111827" })
], { mainColor: "#FFFFFF", contrastColor: "#111827" })

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
], $currentTheme == "dark" ? { mainColor: "#111827", contrastColor: "#F9FAFB" } : { mainColor: "#FFFFFF", contrastColor: "#111827" })`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('rejects Text appearance.mainColor because the component only supports contrastColor', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start", { contrastColor: "#000000", mainColor: "#111827" })
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Text.appearance.mainColor is not allowed.',
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

  it('rejects invalid Input types', () => {
    const result = validateOpenUiSource(`$site = ""
root = AppShell([
  Screen("main", "Main", [
    Input("site", "Site", $site, "https://example.com", null, "color")
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Input.type must be one of "text", "email", "number", "date", "time", "password".',
        }),
      ]),
    );
  });

  it('rejects unsupported validation rules for an Input type', () => {
    const result = validateOpenUiSource(`$name = ""
root = AppShell([
  Screen("main", "Main", [
    Input("name", "Name", $name, "Ada", "Enter your name", "text", [
      { type: "minNumber", value: 1, message: "Wrong rule" }
    ])
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Input type "text" does not support validation rule "minNumber".',
        }),
      ]),
    );
  });

  it('rejects invalid date validation rule values', () => {
    const result = validateOpenUiSource(`$dueDate = ""
root = AppShell([
  Screen("main", "Main", [
    Input("dueDate", "Due date", $dueDate, "", "Pick a due date", "date", [
      { type: "dateOnOrAfter", value: "2026-02-30", message: "Invalid rule value" }
    ])
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Validation rule "dateOnOrAfter" requires a valid YYYY-MM-DD calendar date.',
        }),
      ]),
    );
  });

  it('rejects invalid validation rule types', () => {
    const result = validateOpenUiSource(`$email = ""
root = AppShell([
  Screen("main", "Main", [
    Input("email", "Email", $email, "name@example.com", "Enter email", "email", [
      { type: "pattern", value: ".*" }
    ])
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message:
            'validation[0].type must be one of "required", "minLength", "maxLength", "minNumber", "maxNumber", "dateOnOrAfter", "dateOnOrBefore", "email".',
        }),
      ]),
    );
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
    Text("Hello", "body", "start", { contrastColor: "${invalidColor}" })
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Text.appearance.contrastColor must be a #RRGGBB hex color.',
        }),
      ]),
    );
  });

  it('rejects invalid Screen appearance contrast colors', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ], true, { mainColor: "#111827", contrastColor: "red" })
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Screen.appearance.contrastColor must be a #RRGGBB hex color.',
        }),
      ]),
    );
  });

  it('rejects invalid Screen appearance main colors', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ], true, { mainColor: "red", contrastColor: "#F9FAFB" })
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Screen.appearance.mainColor must be a #RRGGBB hex color.',
        }),
      ]),
    );
  });

  it('rejects legacy textColor and bgColor appearance keys after the theme-pair migration', () => {
    const result = validateOpenUiSource(`root = AppShell([
  Screen("main", "Main", [
    Button("save", "Save", "default", Action([]), false, { textColor: "#FFFFFF", bgColor: "#111827" })
  ])
])`);

    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Button.appearance.textColor is not allowed.',
        }),
        expect.objectContaining({
          code: 'invalid-prop',
          message: 'Button.appearance.bgColor is not allowed.',
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

describe('detectOpenUiQualityWarnings', () => {
  it('does not warn for a simple todo request that stays on one screen', () => {
    const warnings = detectOpenUiQualityWarnings(
      `$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Checkbox(item.title, item.title, item.completed)
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No items yet.")
  ])
])`,
      'Create a todo list.',
    );

    expect(warnings).toEqual([]);
  });

  it('warns when a simple todo request generates multiple screens', () => {
    const warnings = detectOpenUiQualityWarnings(
      `root = AppShell([
  Screen("main", "Todo list", [
    Text("Tasks", "title", "start")
  ]),
  Screen("details", "Details", [
    Text("Task details", "body", "start")
  ], false),
  Screen("settings", "Settings", [
    Text("Preferences", "body", "start")
  ], false)
])`,
      'Create a todo list.',
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-too-many-screens',
          message: 'Simple request generated multiple screens.',
          source: 'quality',
        }),
      ]),
    );
  });

  it('does not warn about theme styling when the prompt asks for a theme', () => {
    const warnings = detectOpenUiQualityWarnings(
      `$currentTheme = "dark"
root = AppShell([
  Screen("main", "Todo list", [
    Text("Theme preview", "body", "start")
  ])
], $currentTheme == "dark" ? { mainColor: "#111827", contrastColor: "#F9FAFB" } : { mainColor: "#FFFFFF", contrastColor: "#111827" })`,
      'Create a todo list with a dark theme.',
    );

    expect(warnings.find((warning) => warning.code === 'quality-unrequested-theme')).toBeUndefined();
  });

  it('warns when theme styling was added without being requested', () => {
    const warnings = detectOpenUiQualityWarnings(
      `$currentTheme = "dark"
root = AppShell([
  Screen("main", "Todo list", [
    Text("Theme preview", "body", "start")
  ])
], $currentTheme == "dark" ? { mainColor: "#111827", contrastColor: "#F9FAFB" } : { mainColor: "#FFFFFF", contrastColor: "#111827" })`,
      'Create a todo list.',
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-unrequested-theme',
          message: 'Theme styling was added even though not requested.',
          source: 'quality',
        }),
      ]),
    );
  });

  it('does not warn about compute tools when the prompt asks for randomness', () => {
    const warnings = detectOpenUiQualityWarnings(
      `rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 6 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

root = AppShell([
  Screen("main", "Dice", [
    Button("roll", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false),
    Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
  ])
])`,
      'Create a random dice roller.',
    );

    expect(warnings.find((warning) => warning.code === 'quality-unrequested-compute')).toBeUndefined();
  });

  it('warns when compute tools were added without being requested', () => {
    const warnings = detectOpenUiQualityWarnings(
      `rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 6 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

root = AppShell([
  Screen("main", "Dice", [
    Button("roll", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false),
    Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
  ])
])`,
      'Create a todo list.',
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-unrequested-compute',
          message: 'Compute tools were added even though not requested.',
          source: 'quality',
        }),
      ]),
    );
  });

  it('warns when filtering was added without being requested', () => {
    const warnings = detectOpenUiQualityWarnings(
      `items = [
  { title: "Write tests", completed: true },
  { title: "Ship changes", completed: false }
]
visibleItems = @Filter(items, "completed", "==", true)
rows = @Each(visibleItems, "item", Text(item.title, "body", "start"))

root = AppShell([
  Screen("main", "Tasks", [
    Repeater(rows, "No tasks")
  ])
])`,
      'Create a todo list.',
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-unrequested-filter',
          message: 'Filtering was added even though not requested.',
          source: 'quality',
        }),
      ]),
    );
  });

  it('warns when validation rules were added without being requested', () => {
    const warnings = detectOpenUiQualityWarnings(
      `$email = ""
root = AppShell([
  Screen("main", "Signup", [
    Input("email", "Email", $email, "name@example.com", "Enter email", "email", [
      { type: "required", message: "Email is required" },
      { type: "email", message: "Enter a valid email" }
    ])
  ])
])`,
      'Create a signup form.',
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-unrequested-validation',
          message: 'Validation rules were added even though not requested.',
          source: 'quality',
        }),
      ]),
    );
  });
});
