import { detectPromptIntents, type PromptRequestOperation } from './promptIntents.js';
import { promptRequiresBlockingTodoControls } from './qualityIntents.js';
import { TODO_TASK_LIST_REQUEST_EXEMPLAR_TEXT } from './sharedExemplars.js';
import type { PromptBuildValidationIssue } from './types.js';

export interface PromptExemplar {
  key: string;
  text: string;
  title: string;
}

const TODO_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'todo-task-list',
  title: 'Todo/task list pattern',
  text: TODO_TASK_LIST_REQUEST_EXEMPLAR_TEXT,
};

const TODO_ADD_FRAGMENT: PromptExemplar = {
  key: 'fragment-todo-add',
  title: 'Todo add fragment',
  text: `$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")`,
};

const TODO_LIST_FRAGMENT: PromptExemplar = {
  key: 'fragment-todo-list',
  title: 'Todo list rows fragment',
  text: `$targetItemId = ""
toggleItem = Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
], "inline"))
Repeater(rows, "No tasks yet.")`,
};

const TODO_FILTER_FRAGMENT: PromptExemplar = {
  key: 'fragment-todo-filter',
  title: 'Todo filter fragment',
  text: `$filter = "all"
filterOptions = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" }
]
visibleItems = $filter == "completed" ? @Filter(items, "completed", "==", true) : $filter == "active" ? @Filter(items, "completed", "==", false) : items
Select("filter", "Show", $filter, filterOptions)`,
};

const VALIDATION_RULES_FRAGMENT: PromptExemplar = {
  key: 'fragment-validation-rules',
  title: 'Validation rules fragment',
  text: `Input("email", "Email", $email, "ada@example.com", "Required email", "email", [
  { type: "required", message: "Email is required" },
  { type: "email", message: "Enter a valid email" }
])
Checkbox("agreement", "I agree", $agreement, "Required to submit", [{ type: "required", message: "Agreement is required" }])`,
};

const THEME_TOGGLE_FRAGMENT: PromptExemplar = {
  key: 'fragment-theme-toggle',
  title: 'Theme toggle fragment',
  text: `$currentTheme = "light"
lightTheme = { mainColor: "#FFFFFF", contrastColor: "#111827" }
darkTheme = { mainColor: "#111827", contrastColor: "#F9FAFB" }
appTheme = $currentTheme == "dark" ? darkTheme : lightTheme
Button("theme-dark", "Dark", "secondary", Action([@Set($currentTheme, "dark")]), false)
root = AppShell([...], appTheme)`,
};

const RANDOM_BUTTON_FRAGMENT: PromptExemplar = {
  key: 'fragment-random-button',
  title: 'Random button-trigger fragment',
  text: `rollDice = Mutation("write_computed_state", { path: "app.roll", op: "random_int", options: { min: 1, max: 6 }, returnType: "number" })
rollValue = Query("read_state", { path: "app.roll" }, null)
Button("roll-dice", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false)
Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")`,
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

const EDITABLE_TODO_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'editable-todo-task-list',
  title: 'Editable todo item pattern',
  text: `$draft = ""
$editTitle = ""
$targetItemId = ""

items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
updateItemTitle = Mutation("update_item_field", {
  path: "app.items",
  idField: "id",
  id: $targetItemId,
  field: "title",
  value: $editTitle
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Button("edit-" + item.id, "Edit", "secondary", Action([@Set($targetItemId, item.id), @Set($editTitle, item.title)]), false)
], "inline"))

root = AppShell([
  Screen("main", "Editable todos", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Group("Edit selected task", "horizontal", [
      Input("edit-title", "Selected task title", $editTitle, "Choose a row first"),
      Button("save-edit", "Save", "default", Action([@Run(updateItemTitle), @Run(items), @Reset($targetItemId, $editTitle)]), $targetItemId == "" || $editTitle == "")
    ], "inline"),
    Repeater(rows, "No tasks yet.")
  ])
])`,
};

const DELETE_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'delete-remove-item',
  title: 'Delete/remove item pattern',
  text: `$targetItemId = ""

items = Query("read_state", { path: "app.items" }, [])
scratchItems = Query("read_state", { path: "app.scratch" }, [])
removeItem = Mutation("remove_item", {
  path: "app.items",
  idField: "id",
  id: $targetItemId
})
removeFirstScratchItem = Mutation("remove_state", { path: "app.scratch", index: 0 })
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Button("remove-" + item.id, "Remove", "destructive", Action([@Set($targetItemId, item.id), @Run(removeItem), @Run(items)]), false)
], "inline"))

root = AppShell([
  Screen("main", "Removable items", [
    Repeater(rows, "No items yet."),
    Button("remove-first-scratch", "Remove first scratch item", "secondary", Action([@Run(removeFirstScratchItem), @Run(scratchItems)]), @Count(scratchItems) == 0)
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

const COMPUTED_VALIDATION_WARNING_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'computed-validation-warning',
  title: 'Computed validation warning pattern',
  text: `$name = ""

nameIsEmpty = Query("compute_value", {
  op: "is_empty",
  input: $name,
  returnType: "boolean"
}, { value: true })

root = AppShell([
  Screen("main", "Name check", [
    Input("name", "Name", $name, "Ada", "Required", "text", [
      { type: "required", message: "Name is required" }
    ]),
    Text(nameIsEmpty.value ? "Warning: name is empty." : "Name looks good.", "body", "start")
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

const THEMED_TODO_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'themed-todo-task-list',
  title: 'Themed todo list pattern',
  text: `$draft = ""
$targetItemId = ""
$currentTheme = "light"
lightTheme = { mainColor: "#F8FAFC", contrastColor: "#0F172A" }
darkTheme = { mainColor: "#111827", contrastColor: "#F9FAFB" }
appTheme = $currentTheme == "dark" ? darkTheme : lightTheme

items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
toggleItem = Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
], "inline"))

root = AppShell([
  Screen("main", "Themed todos", [
    Group("Theme", "horizontal", [
      Button("theme-light", "Light", "secondary", Action([@Set($currentTheme, "light")]), false),
      Button("theme-dark", "Dark", "secondary", Action([@Set($currentTheme, "dark")]), false)
    ], "inline"),
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No tasks yet.")
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
    RadioGroup("answer", "2 + 2?", $answer, answerOptions),
    Button("show-result", "Next", "default", Action([@Set($currentScreen, "result")]), $answer == "")
  ], $currentScreen == "question"),
  Screen("result", "Result", [
    Text($answer == "4" ? "Correct." : "Try again.", "title", "start"),
    Button("restart-quiz", "Restart", "secondary", Action([@Set($currentScreen, "intro"), @Reset($answer)]), false)
  ], $currentScreen == "result")
])`,
};

const MULTI_SCREEN_VALIDATION_FORM_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'multi-screen-validation-form',
  title: 'Multi-screen validation form pattern',
  text: `$currentScreen = "form"
$email = ""
$agree = false

root = AppShell([
  Screen("form", "Contact details", [
    Input("email", "Email", $email, "ada@example.com", "Required email", "email", [
      { type: "required", message: "Email is required" },
      { type: "email", message: "Enter a valid email" }
    ]),
    Checkbox("agree", "I agree", $agree, "Required to continue", [{ type: "required", message: "Agreement is required" }]),
    Button("review", "Review", "default", Action([@Set($currentScreen, "review")]), $email == "" || !$agree)
  ], $currentScreen == "form"),
  Screen("review", "Review", [
    Text("Email: " + $email, "body", "start"),
    Button("back", "Back", "secondary", Action([@Set($currentScreen, "form")]), false),
    Button("submit", "Submit", "default", Action([@Set($currentScreen, "done")]), false)
  ], $currentScreen == "review"),
  Screen("done", "Done", [
    Text("Submitted.", "title", "start")
  ], $currentScreen == "done")
])`,
};

const DATE_COMPARISON_REQUEST_PATTERN =
  /\b(date\s+comparison|compare\s+dates?|deadline|deadlines?|due\s+dates?)\b|(?:сравн[а-яё]*\s+дат[а-яё]*|дедлайн[а-яё]*|срок[а-яё]*)/i;
const EDIT_ITEM_REQUEST_PATTERN =
  /\b(?:edit|rename|update|change)\s+(?:an?\s+)?(?:item|task|todo|row|entry)\b|\b(?:editable|renameable)\s+(?:items?|tasks?|todos?|rows?)\b|(?:редактир\w*|переимен\w*|обнов\w*)\s+(?:задач\w*|элемент\w*|строк\w*)/i;

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
    title: 'Step-flow navigation',
    text: `OK: $currentStep = "intro"
OK: Screen("intro", "Intro", [...], $currentStep == "intro")
OK: Button("go-form", "Open form", "default", Action([@Set($currentStep, "form")]), false)
OK: Screen("form", "Form", [...], $currentStep == "form")
OK: Screen("help", "Help", [...])`,
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
  'quality-random-result-not-visible': {
    key: 'quality-random-result-not-visible',
    title: 'Show persisted random result',
    text: `WRONG: Button("roll", "Roll", "default", Action([@Run(rollDice)]), false)
OK: rollValue = Query("read_state", { path: "app.roll" }, null)
OK: Button("roll", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false)
OK: Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")`,
  },
  'quality-theme-state-not-applied': {
    key: 'quality-theme-state-not-applied',
    title: 'Apply selected theme to AppShell',
    text: `WRONG: appTheme = $currentTheme == "dark" ? darkTheme : lightTheme
WRONG: root = AppShell([Screen("main", "Theme", [...])])
OK: root = AppShell([Screen("main", "Theme", [...])], appTheme)`,
  },
  'item-bound-control-without-action': {
    key: 'item-bound-control-without-action',
    title: 'Persist item-scoped controls with actions',
    text: `WRONG: @Each(items, "item", Checkbox("done-" + item.id, "", item.completed))
OK: toggleItem = Mutation("toggle_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed" })
OK: @Each(items, "item", Checkbox("done-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)])))`,
  },
  'mutation-uses-array-index-path': {
    key: 'mutation-uses-array-index-path',
    title: 'Avoid numeric persisted row paths',
    text: `WRONG: updateFirst = Mutation("write_state", { path: "app.items.0.completed", value: true })
OK: updateItem = Mutation("update_item_field", { path: "app.items", idField: "id", id: $targetItemId, field: "completed", value: true })`,
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

export function getRelevantRequestExemplars(
  userPrompt: string,
  options: { operation?: PromptRequestOperation } = {},
) {
  const exemplars: PromptExemplar[] = [];
  const intents = detectPromptIntents(userPrompt);
  const useFragments = options.operation === 'modify' || options.operation === 'repair';

  if (useFragments) {
    if (intents.todo) {
      exemplars.push(TODO_ADD_FRAGMENT, TODO_LIST_FRAGMENT);
    }

    if (intents.todo && intents.filtering) {
      exemplars.push(TODO_FILTER_FRAGMENT);
    }

    if (intents.validation) {
      exemplars.push(VALIDATION_RULES_FRAGMENT);
    }

    if (intents.theme) {
      exemplars.push(THEME_TOGGLE_FRAGMENT);
    }

    if (intents.random) {
      exemplars.push(RANDOM_BUTTON_FRAGMENT);
    }

    return dedupeExemplars(exemplars);
  }

  if (intents.todo && intents.filtering) {
    exemplars.push(FILTERED_TODO_REQUEST_EXEMPLAR);
  } else if (intents.todo && intents.theme) {
    exemplars.push(THEMED_TODO_REQUEST_EXEMPLAR);
  } else if (promptRequiresBlockingTodoControls(userPrompt)) {
    exemplars.push(TODO_REQUEST_EXEMPLAR);
  }

  if (intents.todo && EDIT_ITEM_REQUEST_PATTERN.test(userPrompt)) {
    exemplars.push(EDITABLE_TODO_REQUEST_EXEMPLAR);
  }

  if (intents.delete) {
    exemplars.push(DELETE_REQUEST_EXEMPLAR);
  }

  if (intents.validation && intents.multiScreen) {
    exemplars.push(MULTI_SCREEN_VALIDATION_FORM_REQUEST_EXEMPLAR);
  } else if (intents.validation && intents.compute && !intents.random && !DATE_COMPARISON_REQUEST_PATTERN.test(userPrompt)) {
    exemplars.push(COMPUTED_VALIDATION_WARNING_REQUEST_EXEMPLAR);
  } else if (intents.validation) {
    exemplars.push(VALIDATION_FORM_REQUEST_EXEMPLAR);
  }

  if (intents.theme && !intents.todo) {
    exemplars.push(THEME_TOGGLE_REQUEST_EXEMPLAR);
  }

  if (intents.random) {
    exemplars.push(RANDOM_DICE_REQUEST_EXEMPLAR);
  } else if (intents.compute && DATE_COMPARISON_REQUEST_PATTERN.test(userPrompt)) {
    exemplars.push(DATE_COMPARISON_REQUEST_EXEMPLAR);
  }

  if (intents.multiScreen && !intents.validation) {
    exemplars.push(MULTI_SCREEN_QUIZ_REQUEST_EXEMPLAR);
  }

  return dedupeExemplars(exemplars);
}
