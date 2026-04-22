export const toolExamples = [
  `$selectedExpenseId = ""
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
])`,
  `$currentTheme = "light"
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
], appTheme)`,
  `savedFilter = Query("read_state", { path: "ui.filter" }, "all")
setFilter = Mutation("write_state", {
  path: "ui.filter",
  value: $lastChoice
})
items = Query("read_state", { path: "app.items" }, [])
visibleItems = savedFilter == "completed" ? @Filter(items, "completed", "==", true) : savedFilter == "active" ? @Filter(items, "completed", "==", false) : items
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
    Select("filter", "Filter", savedFilter, filterOptions, null, [], Action([@Run(setFilter), @Run(savedFilter)])),
    Text("Visible items: " + visibleCount, "muted", "start"),
    Repeater(itemRows, "No matching items.")
  ])
])`,
  `saveProfile = Mutation("merge_state", { path: "app.profile", patch: { theme: "dark", subscribed: true } })
addTag = Mutation("append_state", { path: "app.tags", value: "urgent" })
removeFirstTag = Mutation("remove_state", { path: "app.tags", index: 0 })`,
  `$email = ""
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
])`,
  `roll = Mutation("write_computed_state", {
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
])`,
  `$currentScreen = "question"
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
])`,
  `$draftCard = ""
$targetCardId = ""
savedCards = Query("read_state", { path: "app.savedCards" }, [])
saveCard = Mutation("append_item", {
  path: "app.savedCards",
  value: { title: $draftCard, summary: "Saved from the builder", completed: false }
})
toggleCard = Mutation("toggle_item_field", {
  path: "app.savedCards",
  idField: "id",
  id: $targetCardId,
  field: "completed"
})
removeCard = Mutation("remove_item", {
  path: "app.savedCards",
  idField: "id",
  id: $targetCardId
})
cardRows = @Each(savedCards, "card", Group(null, "vertical", [
  Text(card.title, "title", "start"),
  Text(card.completed ? "Completed" : "Active", "muted", "start"),
  Text(card.summary, "muted", "start"),
  Group(null, "horizontal", [
    Button("toggle-" + card.id, card.completed ? "Mark active" : "Mark complete", "secondary", Action([@Set($targetCardId, card.id), @Run(toggleCard), @Run(savedCards)]), false),
    Button("remove-" + card.id, "Remove", "destructive", Action([@Set($targetCardId, card.id), @Run(removeCard), @Run(savedCards)]), false)
  ], "inline")
]))

root = AppShell([
  Screen("main", "Saved cards", [
    Group("Composer", "vertical", [
      Input("draftCard", "Card title", $draftCard, "Add a saved item"),
      Button("save-card", "Save card", "default", Action([@Run(saveCard), @Run(savedCards), @Reset($draftCard)]), $draftCard == "")
    ]),
    Repeater(cardRows, "No saved cards yet.")
  ])
])`,
  `$dueDate = ""

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
])`,
];
