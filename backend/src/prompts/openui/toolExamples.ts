import { TODO_TASK_LIST_REQUEST_EXEMPLAR_TEXT } from './sharedExemplars.js';
import { detectPromptIntents, type PromptRequestOperation } from './promptIntents.js';

const expenseEditExample = `$selectedExpenseId = ""
$editTitle = ""

expenses = Query("read_state", { path: "app.expenses" }, [])
updateExpenseTitle = Mutation("update_item_field", {
  path: "app.expenses",
  idField: "id",
  id: $selectedExpenseId,
  field: "title",
  value: $editTitle
})
expenseRows = @Each(expenses, "expense", Group(null, "horizontal", [
  Text(expense.title, "body", "start"),
  Button("edit-" + expense.id, "Edit", "secondary", Action([@Set($selectedExpenseId, expense.id), @Set($editTitle, expense.title)]), false)
], "inline"))

root = AppShell([
  Screen("main", "Expenses", [
    Repeater(expenseRows, "No expenses yet."),
    Group("Edit selected expense", "vertical", [
      Text($selectedExpenseId == "" ? "Select an expense to edit." : "Update the selected expense title.", "muted", "start"),
      Input("editTitle", "Title", $editTitle, "Expense title"),
      Button("save-expense", "Save", "default", Action([@Run(updateExpenseTitle), @Run(expenses)]), $selectedExpenseId == "" || $editTitle == "")
    ])
  ])
])`;

const themeExample = `$currentTheme = "light"
$name = "Ada"
$preferredContact = "email"

lightTheme = { mainColor: "#FFFFFF", contrastColor: "#111827" }
darkTheme = { mainColor: "#111827", contrastColor: "#F9FAFB" }
appTheme = $currentTheme == "dark" ? darkTheme : lightTheme
activeThemeButton = { mainColor: "#DC2626", contrastColor: "#FFFFFF" }
inactiveThemeButton = appTheme

contactOptions = [
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" }
]

root = AppShell([
  Screen("main", "Profile form", [
    Group("Theme", "horizontal", [
      Button("theme-light", "Light", "default", Action([@Set($currentTheme, "light")]), false, $currentTheme == "light" ? activeThemeButton : inactiveThemeButton),
      Button("theme-dark", "Dark", "default", Action([@Set($currentTheme, "dark")]), false, $currentTheme == "dark" ? activeThemeButton : inactiveThemeButton)
    ], "inline"),
    Group("Profile", "vertical", [
      Input("name", "Name", $name, "Ada", "Enter your full name"),
      RadioGroup("preferredContact", "Preferred contact", $preferredContact, contactOptions)
    ])
  ])
], appTheme)`;

const filteredItemsExample = `$filter = "all"
items = Query("read_state", { path: "app.items" }, [])
visibleItems = $filter == "completed" ? @Filter(items, "completed", "==", true) : $filter == "active" ? @Filter(items, "completed", "==", false) : items
visibleCount = @Count(visibleItems)
filterOptions = [
  { label: "All items", value: "all" },
  { label: "Active items", value: "active" },
  { label: "Completed items", value: "completed" }
]
itemRows = @Each(visibleItems, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Completed" : "Active", "muted", "start")
], "inline"))

root = AppShell([
  Screen("main", "Filtered items", [
    Select("filter", "Filter", $filter, filterOptions),
    Text("Visible items: " + visibleCount, "muted", "start"),
    Repeater(itemRows, "No matching items.")
  ])
])`;

const stateMutationExamples = `saveProfile = Mutation("merge_state", { path: "app.profile", patch: { theme: "dark", subscribed: true } })
addTag = Mutation("append_state", { path: "app.tags", value: "urgent" })
removeFirstTag = Mutation("remove_state", { path: "app.tags", index: 0 })`;

const validationExample = `$email = ""
$priority = "normal"

priorityOptions = [
  { label: "Low", value: "low" },
  { label: "Normal", value: "normal" },
  { label: "High", value: "high" }
]

root = AppShell([
  Screen("main", "Request form", [
    Group("Details", "vertical", [
      Input("email", "Email", $email, "ada@example.com", "Enter email", "email", [
        { type: "required", message: "Email is required" },
        { type: "email", message: "Enter a valid email" }
      ]),
      Select("priority", "Priority", $priority, priorityOptions, null, [{ type: "required", message: "Choose a priority" }]),
      Button("submit-button", "Submit", "default", Action([]), false)
    ])
  ])
])`;

const randomRollExample = `roll = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 100 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

root = AppShell([
  Screen("main", "Dice", [
    Button("roll-button", "Roll", "default", Action([@Run(roll), @Run(rollValue)]), false),
    Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")
  ])
])`;

const multiScreenExample = `$currentScreen = "question"
$preferredContact = ""
$notes = ""

answerOptions = [
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" }
]
selectedAnswers = [
  { label: "Preferred contact", value: $preferredContact },
  { label: "Notes", value: $notes }
]
answerRows = @Each(selectedAnswers, "answer", Group(null, "vertical", [
  Text(answer.label, "muted", "start"),
  Text(answer.value == "" ? "No response yet." : answer.value, "body", "start")
]))

root = AppShell([
  Screen("question", "Question", [
    RadioGroup("preferredContact", "Preferred contact", $preferredContact, answerOptions),
    Input("notes", "Notes", $notes, "Optional", "Share any extra context"),
    Button("show-result", "Show result", "default", Action([@Set($currentScreen, "result")]), false)
  ], $currentScreen == "question"),
  Screen("result", "Result", [
    Repeater(answerRows, "No answers selected."),
    Button("back-button", "Back", "secondary", Action([@Set($currentScreen, "question")]), false)
  ], $currentScreen == "result")
])`;

const dateComputeExample = `$dueDate = ""

today = Query("compute_value", { op: "today_date", returnType: "string" }, { value: "" })
isOverdue = Query("compute_value", {
  op: "date_before",
  left: $dueDate,
  right: today.value,
  returnType: "boolean"
}, { value: false })

root = AppShell([
  Screen("main", "Deadlines", [
    Input("dueDate", "Due date", $dueDate, "", "Pick a due date", "date", [{ type: "required", message: "Choose a due date" }]),
    Text($dueDate == "" ? "Add a due date." : isOverdue.value ? "This task is overdue." : "This task is not overdue.", "body", "start")
  ])
])`;

const todoListExample = TODO_TASK_LIST_REQUEST_EXEMPLAR_TEXT;

function dedupeToolExamples(examples: string[]) {
  return [...new Set(examples)];
}

function getToolExampleIntents(prompt?: string) {
  return prompt?.trim()
    ? detectPromptIntents(prompt)
      : {
        compute: false,
        controlShowcase: false,
        delete: false,
        filtering: false,
        multiScreen: false,
        random: false,
        theme: false,
        todo: false,
        validation: false,
      };
}

export function buildIntentToolExamplesForPrompt(prompt?: string, options: { operation?: PromptRequestOperation } = {}) {
  if (options.operation === 'modify' || options.operation === 'repair') {
    return [];
  }

  const intents = getToolExampleIntents(prompt);
  const selectedExamples: string[] = [];

  if (intents.todo) {
    selectedExamples.push(todoListExample);
  }

  if (intents.theme) {
    selectedExamples.push(themeExample);
  }

  if (intents.filtering) {
    selectedExamples.push(filteredItemsExample);
  }

  if (intents.validation) {
    selectedExamples.push(validationExample);
  }

  if (intents.random) {
    selectedExamples.push(randomRollExample);
  } else if (intents.compute) {
    selectedExamples.push(dateComputeExample);
  }

  if (intents.multiScreen) {
    selectedExamples.push(multiScreenExample);
  }

  return dedupeToolExamples(selectedExamples);
}

export function buildStableToolExamples(options: { operation?: PromptRequestOperation } = {}) {
  if (options.operation === 'modify' || options.operation === 'repair') {
    return dedupeToolExamples([stateMutationExamples]);
  }

  return dedupeToolExamples([expenseEditExample, stateMutationExamples]);
}
