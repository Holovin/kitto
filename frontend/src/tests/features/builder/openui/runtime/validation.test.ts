import { describe, expect, it } from 'vitest';
import {
  detectLocalRuntimeQualityIssues,
  validateOpenUiSource,
} from '@features/builder/openui/runtime/validation';

const validSource = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;

const LOGGED_IQ_SOURCE = `root = AppShell([
  Screen("quiz", "IQ-like Test", [
    Group("Question 1", "vertical", [
      Text("What number comes next in the sequence: 2, 4, 8, 16, ?", "body", "start"),
      RadioGroup("q1", "Choose an answer", $q1, [
        { label: "18", value: "18" },
        { label: "24", value: "24" },
        { label: "32", value: "32" },
        { label: "36", value: "36" }
      ])
    ], "block"),
    Group("Question 2", "vertical", [
      Text("Which word does not belong: apple, banana, carrot, grape?", "body", "start"),
      RadioGroup("q2", "Choose an answer", $q2, [
        { label: "apple", value: "apple" },
        { label: "banana", value: "banana" },
        { label: "carrot", value: "carrot" },
        { label: "grape", value: "grape" }
      ])
    ], "block"),
    Group("Question 3", "vertical", [
      Text("If all Bloops are Razzies and all Razzies are Lazzies, are all Bloops Lazzies?", "body", "start"),
      RadioGroup("q3", "Choose an answer", $q3, [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
        { label: "Cannot be determined", value: "unknown" },
        { label: "Only sometimes", value: "sometimes" }
      ])
    ], "block"),
    Button("finish-test", "See score", "default", Action([@Set($currentScreen, "result")]), false)
  ], $currentScreen == "quiz"),
  Screen("result", "Result", [
    Group("Your answers", "vertical", [
      Text("Question 1: " + ($q1 == "32" ? "Correct" : "Wrong"), "body", "start"),
      Text("Question 2: " + ($q2 == "carrot" ? "Correct" : "Wrong"), "body", "start"),
      Text("Question 3: " + ($q3 == "yes" ? "Correct" : "Wrong"), "body", "start"),
      Text("Score: " + (($q1 == "32" ? 1 : 0) + ($q2 == "carrot" ? 1 : 0) + ($q3 == "yes" ? 1 : 0)) + "/3", "title", "start")
    ], "block"),
    Button("back-to-quiz", "Back", "secondary", Action([@Set($currentScreen, "quiz")]), false)
  ], $currentScreen == "result")
])`;

const REPAIRED_LOGGED_IQ_SOURCE = `$currentScreen = "quiz"
$q1 = ""
$q2 = ""
$q3 = ""

${LOGGED_IQ_SOURCE}`;

const LANGUAGE_SWITCHER_SOURCE = `$language = "en"

root = AppShell([
  Screen("main", "Language switcher", [
    Group("Pick language", "horizontal", [
      Button("lang-en", "English", "default", Action([@Set($language, "en")]), $language == "en"),
      Button("lang-es", "Spanish", "secondary", Action([@Set($language, "es")]), $language == "es")
    ], "inline"),
    Text($language == "en" ? "Hello" : "Hola", "body", "start")
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

  it('treats null validation placeholders as omitted validation rules', () => {
    const result = validateOpenUiSource(`$answer = ""
answerOptions = [
  { label: "Hallo", value: "hallo" },
  { label: "Danke", value: "danke" }
]
root = AppShell([
  Screen("main", "Main", [
    RadioGroup("answer", "Answer", $answer, answerOptions, null, null)
  ])
])`);

    expect(result).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it('lets null validation placeholders reach action-binding quality repair checks', () => {
    const source = `$answer = ""
answerOptions = [
  { label: "Hallo", value: "hallo" },
  { label: "Danke", value: "danke" }
]
answerSelect = RadioGroup("answer", "Answer", $answer, answerOptions, null, null, Action([@Set($answer, $lastChoice)]))
root = AppShell([
  Screen("main", "Main", [answerSelect])
])`;

    expect(validateOpenUiSource(source)).toEqual({
      isValid: true,
      issues: [],
    });
    expect(detectLocalRuntimeQualityIssues(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'control-action-and-binding',
          statementId: 'answerSelect',
        }),
      ]),
    );
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

  it('accepts collection-item tools with relay-variable row actions', () => {
    const result = validateOpenUiSource(`$draft = ""
$targetItemId = ""

items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
toggleItem = Mutation("toggle_item_field", {
  path: "app.items",
  idField: "id",
  id: $targetItemId,
  field: "completed"
})
updateItem = Mutation("update_item_field", {
  path: "app.items",
  idField: "id",
  id: $targetItemId,
  field: "title",
  value: $draft
})
removeItem = Mutation("remove_item", {
  path: "app.items",
  idField: "id",
  id: $targetItemId
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end"),
  Button("toggle-" + item.id, "Toggle", "secondary", Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]), false),
  Button("remove-" + item.id, "Remove", "destructive", Action([@Set($targetItemId, item.id), @Run(removeItem), @Run(items)]), false)
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Input("draft", "Task", $draft, "New task"),
    Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == ""),
    Repeater(rows, "No tasks yet.")
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

describe('detectLocalRuntimeQualityIssues', () => {
  it('marks logged IQ drafts that use $currentScreen without a top-level declaration', () => {
    const issues = detectLocalRuntimeQualityIssues(LOGGED_IQ_SOURCE);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'undefined-state-reference',
          message: expect.stringContaining('$currentScreen'),
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'root',
        }),
      ]),
    );
  });

  it('accepts the repaired logged IQ draft after missing state declarations are added', () => {
    expect(validateOpenUiSource(REPAIRED_LOGGED_IQ_SOURCE)).toEqual({
      isValid: true,
      issues: [],
    });
    expect(
      detectLocalRuntimeQualityIssues(REPAIRED_LOGGED_IQ_SOURCE).find((issue) => issue.code === 'undefined-state-reference'),
    ).toBeUndefined();
  });

  it('does not mark the canonical todo recipe when its local state is declared', () => {
    const issues = detectLocalRuntimeQualityIssues(`$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues.find((issue) => issue.code === 'undefined-state-reference')).toBeUndefined();
  });

  it('does not mark a declared language switcher state as undefined', () => {
    const issues = detectLocalRuntimeQualityIssues(LANGUAGE_SWITCHER_SOURCE);

    expect(issues.find((issue) => issue.code === 'undefined-state-reference')).toBeUndefined();
  });

  it('marks Checkbox action mode plus writable binding as blocking quality', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `$accepted = false

root = AppShell([
  Screen("main", "Main", [
    Checkbox("accepted", "Persist acceptance", $accepted, "Persists acceptance", [], Action([]))
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'control-action-and-binding',
          message:
            'Form-control cannot have both action and a writable $binding. Use $binding for form state, or action for persisted updates.',
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('marks RadioGroup and Select action mode plus writable binding as blocking quality', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `$plan = "pro"
$filter = "all"
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]
filterOptions = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" }
]

root = AppShell([
  Screen("main", "Main", [
    RadioGroup("plan", "Plan", $plan, planOptions, null, [], Action([])),
    Select("filter", "Filter", $filter, filterOptions, null, [], Action([]))
  ])
])`);

    expect(issues.filter((issue) => issue.code === 'control-action-and-binding')).toHaveLength(2);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'control-action-and-binding',
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('marks bare top-level string option arrays for RadioGroup and Select as blocking quality', () => {
    const source = `$answer = ""
$filter = ""
rickrollOptions = [
  "Never gonna give you up",
  "Never gonna let you down"
]

root = AppShell([
  Screen("main", "Rickroll quiz", [
    RadioGroup("answer", "Pick a lyric", $answer, rickrollOptions),
    Select("filter", "Filter", $filter, rickrollOptions)
  ])
])`;

    expect(validateOpenUiSource(source)).toEqual({
      isValid: true,
      issues: [],
    });

    expect(detectLocalRuntimeQualityIssues(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-options-shape',
          message: 'RadioGroup/Select options must be `{label, value}` objects, not bare strings or numbers.',
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'rickrollOptions',
        }),
      ]),
    );
  });

  it('marks collection-backed string option arrays as blocking quality and points to the declaration', () => {
    const source = `$currentQuestion = 0
$answer = ""
questions = [
  {
    prompt: "Which lyric starts the chorus?",
    options: [
      "Never gonna give you up",
      "Never gonna let you down"
    ]
  }
]

root = AppShell([
  Screen("main", "Rickroll quiz", [
    RadioGroup("answer", questions[$currentQuestion].prompt, $answer, questions[$currentQuestion].options)
  ])
])`;

    expect(validateOpenUiSource(source)).toEqual({
      isValid: true,
      issues: [],
    });

    expect(detectLocalRuntimeQualityIssues(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-options-shape',
          message: expect.stringContaining('Collection `questions` contains `.options` arrays'),
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'questions',
        }),
      ]),
    );
  });

  it('allows RadioGroup and Select action mode to route the chosen value through $lastChoice', () => {
    const source = `savedPlan = Query("read_state", { path: "demo.plan" }, "pro")
savePlan = Mutation("write_state", {
  path: "demo.plan",
  value: $lastChoice
})
savedFilter = Query("read_state", { path: "demo.filter" }, "all")
saveFilter = Mutation("write_state", {
  path: "demo.filter",
  value: $lastChoice
})
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]
filterOptions = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" }
]

root = AppShell([
  Screen("main", "Main", [
    RadioGroup("saved-plan", "Persisted plan", savedPlan, planOptions, null, [], Action([@Run(savePlan), @Run(savedPlan)])),
    Select("saved-filter", "Show", savedFilter, filterOptions, null, [], Action([@Run(saveFilter), @Run(savedFilter)]))
  ])
])`;

    expect(validateOpenUiSource(source)).toEqual({
      isValid: true,
      issues: [],
    });
    expect(detectLocalRuntimeQualityIssues(source)).toEqual([]);
  });

  it('accepts a logged kanban draft that routes Select actions through a top-level $lastChoice mutation', () => {
    const source = `$draftTitle = ""
$draftColumn = "todo"
$targetItemId = ""
items = Query("read_state", { path: "app.kanbanItems" }, [])
addItem = Mutation("append_item", {
  path: "app.kanbanItems",
  value: { title: $draftTitle, column: $draftColumn, completed: false }
})
moveItem = Mutation("update_item_field", {
  path: "app.kanbanItems",
  idField: "id",
  id: $targetItemId,
  field: "column",
  value: $lastChoice
})
removeItem = Mutation("remove_item", {
  path: "app.kanbanItems",
  idField: "id",
  id: $targetItemId
})
columnOptions = [
  { label: "Todo", value: "todo" },
  { label: "Doing", value: "doing" },
  { label: "Done", value: "done" }
]
todoItems = @Filter(items, "column", "==", "todo")
doingItems = @Filter(items, "column", "==", "doing")
doneItems = @Filter(items, "column", "==", "done")
todoRows = @Each(todoItems, "item", Group(null, "vertical", [
  Text(item.title, "body", "start"),
  Group(null, "horizontal", [
    Select("move-todo-" + item.id, "Move", item.column, columnOptions, null, [], Action([@Set($targetItemId, item.id), @Run(moveItem), @Run(items)])),
    Button("remove-todo-" + item.id, "Remove", "destructive", Action([@Set($targetItemId, item.id), @Run(removeItem), @Run(items)]), false)
  ], "inline")
], "block"))
doingRows = @Each(doingItems, "item", Group(null, "vertical", [
  Text(item.title, "body", "start"),
  Group(null, "horizontal", [
    Select("move-doing-" + item.id, "Move", item.column, columnOptions, null, [], Action([@Set($targetItemId, item.id), @Run(moveItem), @Run(items)])),
    Button("remove-doing-" + item.id, "Remove", "destructive", Action([@Set($targetItemId, item.id), @Run(removeItem), @Run(items)]), false)
  ], "inline")
], "block"))
doneRows = @Each(doneItems, "item", Group(null, "vertical", [
  Text(item.title, "body", "start"),
  Group(null, "horizontal", [
    Select("move-done-" + item.id, "Move", item.column, columnOptions, null, [], Action([@Set($targetItemId, item.id), @Run(moveItem), @Run(items)])),
    Button("remove-done-" + item.id, "Remove", "destructive", Action([@Set($targetItemId, item.id), @Run(removeItem), @Run(items)]), false)
  ], "inline")
], "block"))
root = AppShell([
  Screen("main", "Kanban board", [
    Group("Quick add", "vertical", [
      Input("draftTitle", "Task title", $draftTitle, "Add a task", "Type a new task and choose a column"),
      Select("draftColumn", "Column", $draftColumn, columnOptions, "Choose where the task starts"),
      Button("add-task", "Add task", "default", Action([@Run(addItem), @Run(items), @Reset($draftTitle)]), $draftTitle == "")
    ], "block", { mainColor: "#FFF7ED", contrastColor: "#9A3412" }),
    Group(null, "horizontal", [
      Group("Todo", "vertical", [
        Repeater(todoRows, "No todo tasks yet.")
      ], "block", { mainColor: "#FEF2F2", contrastColor: "#B91C1C" }),
      Group("Doing", "vertical", [
        Repeater(doingRows, "No doing tasks yet.")
      ], "block", { mainColor: "#EFF6FF", contrastColor: "#1D4ED8" }),
      Group("Done", "vertical", [
        Repeater(doneRows, "No done tasks yet.")
      ], "block", { mainColor: "#ECFDF5", contrastColor: "#047857" })
    ], "inline")
  ], true, { mainColor: "#111827", contrastColor: "#F9FAFB" })
], { mainColor: "#111827", contrastColor: "#F9FAFB" })`;

    expect(validateOpenUiSource(source)).toEqual({
      isValid: true,
      issues: [],
    });
    expect(
      detectLocalRuntimeQualityIssues(source),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'reserved-last-choice-outside-action-mode',
        }),
      ]),
    );
  });

  it('marks $lastChoice outside Select/RadioGroup action mode flows as blocking quality', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `setFilter = Mutation("write_state", {
  path: "demo.filter",
  value: $lastChoice
})

root = AppShell([
  Screen("main", "Main", [
    Button("apply-filter", "Apply", "default", Action([@Run(setFilter)]), false),
    Text("Last choice: " + $lastChoice, "body", "start")
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'reserved-last-choice-outside-action-mode',
          message: expect.stringContaining('reserved for Select/RadioGroup action mode'),
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('marks item-bound controls inside @Each without action as blocking quality', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `items = Query("read_state", { path: "app.items" }, [])
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed)
], "inline"))

root = AppShell([
  Screen("main", "Items", [
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'item-bound-control-without-action',
          message:
            'Item-scoped control without `action` will not persist changes back to `items`. Use action-mode with `toggle_item_field` / `update_item_field`.',
          severity: 'blocking-quality',
          source: 'quality',
        }),
      ]),
    );
  });

  it('does not mark item-bound controls inside @Each when action mode is used', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `items = Query("read_state", { path: "app.items" }, [])
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([]))
], "inline"))

root = AppShell([
  Screen("main", "Items", [
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues.find((issue) => issue.code === 'item-bound-control-without-action')).toBeUndefined();
  });

  it('marks index-based persisted mutation paths as blocking quality', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `toggleFirst = Mutation("merge_state", {
  path: "app.items.0",
  patch: { completed: true }
})

root = AppShell([
  Screen("main", "Items", [
    Text("Items", "body", "start")
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mutation-uses-array-index-path',
          message:
            'Mutating array elements by index is fragile. Use `toggle_item_field`, `update_item_field`, or `remove_item` with `idField`+`id`.',
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'toggleFirst',
        }),
      ]),
    );
  });

  it('does not mark collection-level persisted mutation paths as blocking', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `saveItems = Mutation("write_state", {
  path: "app.items",
  value: []
})

root = AppShell([
  Screen("main", "Items", [
    Text("Items", "body", "start")
  ])
])`);

    expect(issues.find((issue) => issue.code === 'mutation-uses-array-index-path')).toBeUndefined();
  });

  it('rejects inline tool calls inside @Each row actions via parser or blocking quality issues', () => {
    const source = `$selectedItemId = ""
items = Query("read_state", { path: "app.items" }, [
  { id: "a", title: "Alpha" }
])
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Button("pick-item", "Pick", "default", Action([
    @Set($selectedItemId, item.id),
    @Run(Mutation("write_state", { path: "app.selectedItemId", value: $selectedItemId }))
  ]), false)
], "inline"))

root = AppShell([
  Screen("main", "Items", [
    Repeater(rows, "No items yet.")
  ])
])`;

    const validation = validateOpenUiSource(source);
    const issues = detectLocalRuntimeQualityIssues(source);
    const parserCaughtInlineTool = validation.issues.some((issue) => issue.code === 'inline-reserved');
    const qualityIssue = issues.find((issue) => issue.code === 'inline-tool-in-each');

    expect(parserCaughtInlineTool || qualityIssue != null).toBe(true);

    if (!parserCaughtInlineTool) {
      expect(qualityIssue).toEqual(
        expect.objectContaining({
          code: 'inline-tool-in-each',
          message: expect.stringContaining('must be top-level statements'),
          severity: 'blocking-quality',
          source: 'quality',
        }),
      );
    }
  });

  it('marks stale append_state refresh as blocking', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Input("draft", "Task", $draft, "New task"),
    Button("add-task", "Add", "default", Action([@Run(addItem), @Reset($draft)]), $draft == ""),
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-stale-persisted-query',
          message:
            'Persisted mutation may not refresh visible query. After @Run(addItem), also run @Run(items) later in the same Action for affected path "app.items".',
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'addItem',
        }),
      ]),
    );
  });

  it('marks stale toggle_item_field refresh as blocking', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `$targetItemId = ""
items = Query("read_state", { path: "app.items" }, [])
toggleItem = Mutation("toggle_item_field", {
  path: "app.items",
  idField: "id",
  id: $targetItemId,
  field: "completed"
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Button("toggle-first", "Toggle first", "default", Action([@Set($targetItemId, "task-1"), @Run(toggleItem)]), false),
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-stale-persisted-query',
          message:
            'Persisted mutation may not refresh visible query. After @Run(toggleItem), also run @Run(items) later in the same Action for affected path "app.items".',
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'toggleItem',
        }),
      ]),
    );
  });

  it('marks a query that runs before the mutation as blocking stale refresh', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Input("draft", "Task", $draft, "New task"),
    Button("add-task", "Add", "default", Action([@Run(items), @Run(addItem), @Reset($draft)]), $draft == ""),
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-stale-persisted-query',
          message:
            'Persisted mutation may not refresh visible query. After @Run(addItem), also run @Run(items) later in the same Action for affected path "app.items".',
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'addItem',
        }),
      ]),
    );
  });

  it('marks a child-path mutation without parent-path refresh as blocking', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `$flash = ""
items = Query("read_state", { path: "app.items" }, [])
toggleFirst = Mutation("merge_state", {
  path: "app.items.0",
  patch: { completed: true }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Button("toggle-first", "Toggle first", "default", Action([@Run(toggleFirst), @Set($flash, "done")]), false),
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-stale-persisted-query',
          message:
            'Persisted mutation may not refresh visible query. After @Run(toggleFirst), also run @Run(items) later in the same Action for affected path "app.items.0".',
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'toggleFirst',
        }),
      ]),
    );
  });

  it('marks a parent-path mutation without child-path refresh as blocking', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `themeValue = Query("read_state", { path: "app.settings.theme" }, "light")
saveSettings = Mutation("write_state", {
  path: "app.settings",
  value: { theme: "dark" }
})

root = AppShell([
  Screen("main", "Settings", [
    Button("save-settings", "Save settings", "default", Action([@Run(saveSettings)]), false),
    Text("Theme: " + themeValue, "body", "start")
  ])
])`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'quality-stale-persisted-query',
          message:
            'Persisted mutation may not refresh visible query. After @Run(saveSettings), also run @Run(themeValue) later in the same Action for affected path "app.settings".',
          severity: 'blocking-quality',
          source: 'quality',
          statementId: 'saveSettings',
        }),
      ]),
    );
  });

  it('does not mark a child-path mutation as stale when a parent-path query reruns later in the same Action', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `$flash = ""
items = Query("read_state", { path: "app.items" }, [])
toggleFirst = Mutation("merge_state", {
  path: "app.items.0",
  patch: { completed: true }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Button("toggle-first", "Toggle first", "default", Action([@Run(toggleFirst), @Reset($flash), @Run(items)]), false),
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues.find((issue) => issue.code === 'quality-stale-persisted-query')).toBeUndefined();
  });

  it('does not mark persisted refresh as blocking when the matching query reruns later in the same Action', () => {
    const issues = detectLocalRuntimeQualityIssues(
      `$draft = ""
$flash = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Input("draft", "Task", $draft, "New task"),
    Button("add-task", "Add", "default", Action([@Run(addItem), @Set($flash, "saving"), @Run(items), @Reset($draft)]), $draft == ""),
    Repeater(rows, "No items yet.")
  ])
])`);

    expect(issues.find((issue) => issue.code === 'quality-stale-persisted-query')).toBeUndefined();
  });
});
