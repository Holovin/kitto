import { detectPromptIntents } from './promptIntents.js';
import { promptRequiresBlockingTodoControls } from './qualityIntents.js';
import type { PromptBuildValidationIssue } from './types.js';

export interface PromptExemplar {
  key: string;
  text: string;
  title: string;
}

const TODO_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'todo-task-list',
  title: 'Todo/task list pattern',
  text: `$draft = ""
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
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No tasks yet.")
  ])
])`,
};

const FILTERED_TODO_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'filtered-todo-task-list',
  title: 'Filtered todo list pattern',
  text: `$draft = ""
$targetItemId = ""
$filter = "all"
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
toggleItem = Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })
filterOptions = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" }
]
visibleItems = $filter == "completed" ? @Filter(items, "completed", "==", true) : $filter == "active" ? @Filter(items, "completed", "==", false) : items
rows = @Each(visibleItems, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
], "inline"))

root = AppShell([
  Screen("main", "Todos", [
    Select("filter", "Show", $filter, filterOptions),
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No matching tasks.")
  ])
])`,
};

const VALIDATION_FORM_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'validation-form',
  title: 'Validation form pattern',
  text: `$email = ""
$quantity = ""
$agreement = false

root = AppShell([
  Screen("main", "Request form", [
    Input("email", "Email", $email, "ada@example.com", "Required email", "email", [
      { type: "required", message: "Email is required" },
      { type: "email", message: "Enter a valid email" }
    ]),
    Input("quantity", "Quantity", $quantity, "1", "1-10", "number", [
      { type: "required", message: "Quantity is required" },
      { type: "minNumber", value: 1, message: "Minimum is 1" },
      { type: "maxNumber", value: 10, message: "Maximum is 10" }
    ]),
    Checkbox("agreement", "I agree", $agreement, "Required to submit", [{ type: "required", message: "Agreement is required" }]),
    Button("submit", "Submit", "default", Action([]), false)
  ])
])`,
};

const THEME_TOGGLE_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'theme-toggle',
  title: 'Theme toggle pattern',
  text: `$currentTheme = "light"
lightTheme = { mainColor: "#FFFFFF", contrastColor: "#111827" }
darkTheme = { mainColor: "#111827", contrastColor: "#F9FAFB" }
appTheme = $currentTheme == "dark" ? darkTheme : lightTheme
activeThemeButton = { mainColor: "#DC2626", contrastColor: "#FFFFFF" }
inactiveThemeButton = appTheme

root = AppShell([
  Screen("main", "Theme", [
    Group("Theme", "horizontal", [
      Button("theme-light", "Light", "default", Action([@Set($currentTheme, "light")]), false, $currentTheme == "light" ? activeThemeButton : inactiveThemeButton),
      Button("theme-dark", "Dark", "default", Action([@Set($currentTheme, "dark")]), false, $currentTheme == "dark" ? activeThemeButton : inactiveThemeButton)
    ], "inline"),
    Text("Current theme: " + $currentTheme, "body", "start")
  ])
], appTheme)`,
};

const RANDOM_DICE_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'random-dice',
  title: 'Random dice pattern',
  text: `rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 6 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

root = AppShell([
  Screen("main", "Dice", [
    Button("roll-dice", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false),
    Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
  ])
])`,
};

const DATE_COMPARISON_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'date-comparison',
  title: 'Date comparison pattern',
  text: `$startDate = ""
$endDate = ""
endsOnOrAfterStart = Query("compute_value", {
  op: "date_on_or_after",
  left: $endDate,
  right: $startDate,
  returnType: "boolean"
}, { value: false })

root = AppShell([
  Screen("main", "Date check", [
    Input("startDate", "Start date", $startDate, "", "YYYY-MM-DD", "date", [{ type: "required", message: "Choose a start date" }]),
    Input("endDate", "End date", $endDate, "", "YYYY-MM-DD", "date", [{ type: "required", message: "Choose an end date" }]),
    Text($startDate == "" || $endDate == "" ? "Choose both dates." : endsOnOrAfterStart.value ? "End date is valid." : "End date is before start date.", "body", "start")
  ])
])`,
};

const MULTI_SCREEN_QUIZ_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'multi-screen-quiz',
  title: 'Multi-screen quiz pattern',
  text: `$currentScreen = "intro"
$answer = ""
answerOptions = [
  { label: "3", value: "3" },
  { label: "4", value: "4" }
]

root = AppShell([
  Screen("intro", "Quiz", [
    Button("start-quiz", "Start", "default", Action([@Set($currentScreen, "question")]), false)
  ], $currentScreen == "intro"),
  Screen("question", "Question", [
    RadioGroup("answer", "2 + 2?", $answer, answerOptions, null, [{ type: "required", message: "Choose an answer" }]),
    Button("show-result", "Next", "default", Action([@Set($currentScreen, "result")]), $answer == "")
  ], $currentScreen == "question"),
  Screen("result", "Result", [
    Text($answer == "4" ? "Correct." : "Try again.", "title", "start"),
    Button("restart-quiz", "Restart", "secondary", Action([@Set($currentScreen, "intro"), @Reset($answer)]), false)
  ], $currentScreen == "result")
])`,
};

const DATE_COMPARISON_REQUEST_PATTERN =
  /\b(date\s+comparison|compare\s+dates?|deadline|deadlines?|due\s+dates?)\b|(?:сравн[а-яё]*\s+дат[а-яё]*|дедлайн[а-яё]*|срок[а-яё]*)/i;

const REPAIR_EXEMPLARS: Record<string, PromptExemplar> = {
  'control-action-and-binding': {
    key: 'control-action-and-binding',
    title: 'Action mode vs binding mode',
    text: `WRONG: Checkbox("toggle-" + item.id, "", $checked, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
OK: Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))`,
  },
  'inline-tool-in-each': {
    key: 'inline-tool-hoist',
    title: 'Hoist tools out of @Each(...)',
    text: `WRONG: @Each(items, "item", Mutation("append_item", { path: "app.items", value: { title: item.title } }))
OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft } })
OK: @Each(items, "item", Button("save-" + item.id, "Save", "default", Action([@Run(addItem)]), false))`,
  },
  'inline-tool-in-prop': {
    key: 'inline-tool-hoist',
    title: 'Hoist tools out of component props',
    text: `WRONG: Button("save", "Save", "default", Action([@Run(Mutation("append_item", { path: "app.items", value: { title: $draft } }))]), false)
OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft } })
OK: Button("save", "Save", "default", Action([@Run(addItem)]), false)`,
  },
  'inline-tool-in-repeater': {
    key: 'inline-tool-hoist',
    title: 'Hoist tools before Repeater(...)',
    text: `WRONG: Repeater([Mutation("append_item", { path: "app.items", value: { title: $draft } })], "No items")
OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft } })
OK: Repeater(rows, "No items")`,
  },
  'quality-missing-todo-controls': {
    key: 'quality-missing-todo-controls',
    title: 'Interactive todo pattern',
    text: `WRONG: root = AppShell([Screen("main", "Todo", [Text("Todo", "title", "start")])])
OK: $draft = ""
OK: items = Query("read_state", { path: "app.items" }, [])
OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
OK: rows = @Each(items, "item", ...)
OK: Repeater(rows, "No tasks yet.")`,
  },
  'quality-missing-control-showcase-components': {
    key: 'quality-missing-control-showcase-components',
    title: 'Control showcase coverage',
    text: `OK: Input("name", "Name", $name)
OK: TextArea("notes", "Notes", $notes)
OK: Checkbox("agree", "Agree", $agree)
OK: RadioGroup("choice", "Choice", $choice, options)
OK: Select("status", "Status", $status, options)
OK: Button("submit", "Submit", "default", Action([]), false)
OK: Link("Docs", "https://example.com")`,
  },
  'quality-missing-screen-flow': {
    key: 'quality-missing-screen-flow',
    title: 'Current-screen navigation',
    text: `OK: $currentScreen = "browse"
OK: Screen("browse", "Browse", [...], $currentScreen == "browse")
OK: Button("go-form", "Open form", "default", Action([@Set($currentScreen, "form")]), false)
OK: Screen("form", "Form", [...], $currentScreen == "form")`,
  },
  'quality-options-shape': {
    key: 'quality-options-shape',
    title: 'Option object shape',
    text: `WRONG: ["Email", "Phone"]
OK: [{ label: "Email", value: "email" }, { label: "Phone", value: "phone" }]`,
  },
  'quality-stale-persisted-query': {
    key: 'quality-stale-persisted-query',
    title: 'Refresh visible query after mutation',
    text: `WRONG: Button("add-task", "Add", "default", Action([@Run(addItem), @Reset($draft)]), $draft == "")
OK: Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")`,
  },
  'reserved-last-choice-outside-action-mode': {
    key: 'reserved-last-choice-outside-action-mode',
    title: 'Use $lastChoice only inside action-mode flows',
    text: `WRONG: Text("Selected filter: " + $lastChoice, "body", "start")
OK: savePlan = Mutation("write_state", { path: "ui.plan", value: $lastChoice })
OK: Select("plan", "Plan", savedPlan, planOptions, null, null, Action([@Run(savePlan), @Run(savedPlan)]))`,
  },
  'undefined-state-reference': {
    key: 'undefined-state-reference',
    title: 'Declare missing $state before root',
    text: `WRONG: root = AppShell([Screen("main", "Draft", [Text($draft, "body", "start")])])
OK: $draft = ""
OK: root = AppShell([Screen("main", "Draft", [Text($draft, "body", "start")])])`,
  },
};

function dedupeExemplars(exemplars: PromptExemplar[]) {
  const seenKeys = new Set<string>();
  return exemplars.filter((exemplar) => {
    if (seenKeys.has(exemplar.key)) {
      return false;
    }

    seenKeys.add(exemplar.key);
    return true;
  });
}

export function getRelevantRepairExemplars(issues: PromptBuildValidationIssue[]) {
  return dedupeExemplars(
    issues
      .map((issue) => REPAIR_EXEMPLARS[issue.code])
      .filter((exemplar): exemplar is PromptExemplar => exemplar != null),
  );
}

export function getRelevantRequestExemplars(userPrompt: string) {
  const exemplars: PromptExemplar[] = [];
  const intents = detectPromptIntents(userPrompt);

  if (intents.todo && intents.filtering) {
    exemplars.push(FILTERED_TODO_REQUEST_EXEMPLAR);
  } else if (promptRequiresBlockingTodoControls(userPrompt)) {
    exemplars.push(TODO_REQUEST_EXEMPLAR);
  }

  if (intents.validation) {
    exemplars.push(VALIDATION_FORM_REQUEST_EXEMPLAR);
  }

  if (intents.theme) {
    exemplars.push(THEME_TOGGLE_REQUEST_EXEMPLAR);
  }

  if (intents.random) {
    exemplars.push(RANDOM_DICE_REQUEST_EXEMPLAR);
  } else if (intents.compute && DATE_COMPARISON_REQUEST_PATTERN.test(userPrompt)) {
    exemplars.push(DATE_COMPARISON_REQUEST_EXEMPLAR);
  }

  if (intents.multiScreen) {
    exemplars.push(MULTI_SCREEN_QUIZ_REQUEST_EXEMPLAR);
  }

  return dedupeExemplars(exemplars);
}
