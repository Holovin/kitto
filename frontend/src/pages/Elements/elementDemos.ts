interface ElementDemoDefinition {
  initialDomainData?: Record<string, unknown>;
  initialRuntimeState?: Record<string, unknown>;
  source: string;
}

export const ELEMENT_DEMO_DEFINITIONS: Record<string, ElementDemoDefinition> = {
  AppShell: {
    source: `$currentScreen = "overview"
$theme = "light"

lightTheme = { mainColor: "#FFFFFF", contrastColor: "#111827" }
darkTheme = { mainColor: "#0F172A", contrastColor: "#F9FAFB" }
appTheme = $theme == "dark" ? darkTheme : lightTheme
activeThemeButton = { mainColor: "#FFFFFF", contrastColor: "#DC2626" }

root = AppShell([
  Screen("overview", "Overview", [
    Group("Theme", "horizontal", [
      Button("theme-light", "Light", "default", Action([@Set($theme, "light")]), false, $theme == "light" ? activeThemeButton : appTheme),
      Button("theme-dark", "Dark", "default", Action([@Set($theme, "dark")]), false, $theme == "dark" ? activeThemeButton : appTheme)
    ], "inline"),
    Group("Root shell", "vertical", [
      Text("AppShell can also set the inherited theme for everything below it.", "body", "start"),
      Button("show-details", "Show details", "secondary", Action([@Set($currentScreen, "details")]), false)
    ])
  ], $currentScreen == "overview"),
  Screen("details", "Details", [
    Group("Nested content", "vertical", [
      Text("Only the active Screen is visible at a time.", "body", "start"),
      Button("show-overview", "Show overview", "secondary", Action([@Set($currentScreen, "overview")]), false)
    ])
  ], $currentScreen == "details")
], appTheme)`,
  },
  Screen: {
    source: `$currentScreen = "alpha"

alphaAppearance = { mainColor: "#F8FAFC", contrastColor: "#0F172A" }
betaAppearance = { mainColor: "#E0F2FE", contrastColor: "#0F172A" }

root = AppShell([
  Screen("alpha", "Alpha", [
    Group("First screen", "vertical", [
      Text("Alpha is visible right now.", "body", "start"),
      Button("go-beta", "Go to beta", "default", Action([@Set($currentScreen, "beta")]), false)
    ])
  ], $currentScreen == "alpha", alphaAppearance),
  Screen("beta", "Beta", [
    Group("Second screen", "vertical", [
      Text("Beta is active.", "body", "start"),
      Button("go-alpha", "Go to alpha", "secondary", Action([@Set($currentScreen, "alpha")]), false)
    ])
  ], $currentScreen == "beta", betaAppearance)
])`,
  },
  Group: {
    source: `$name = "Ada Lovelace"
$email = "ada@example.com"
$role = "engineer"

roleOptions = [
  { label: "Engineer", value: "engineer" },
  { label: "Designer", value: "designer" }
]

root = AppShell([
  Screen("main", "Layout", [
    Group("Block section", "vertical", [
      Text("Block groups render as full visual sections.", "muted", "start"),
      Group("Inline fields", "horizontal", [
        Input("name", "Name", $name, "Ada Lovelace"),
        Input("email", "Email", $email, "ada@example.com")
      ], "inline"),
      Group("Inline filters", "horizontal", [
        Select("role", "Role", $role, roleOptions),
        Button("reset-role", "Reset role", "secondary", Action([@Set($role, "engineer")]), false)
      ], "inline")
    ]),
    Group("Block actions", "horizontal", [
      Button("primary-action", "Primary action", "default", Action([@Set($role, "engineer")]), false),
      Button("secondary-action", "Secondary action", "secondary", Action([@Set($role, "designer")]), false)
    ]),
    Group("Another vertical group", "vertical", [
      Text("Name: " + $name, "body", "start"),
      Text("Email: " + $email, "body", "start"),
      Text("Role: " + $role, "body", "start")
    ]),
    Group("Dark section", "vertical", [
      Text("Appearance overrides support dark-looking sections without exposing raw CSS.", "body", "start"),
      Button("save-dark", "Save changes", "default", Action([@Set($role, "designer")]), false, { mainColor: "#FFFFFF", contrastColor: "#2563EB" })
    ], "block", { mainColor: "#111827", contrastColor: "#F9FAFB" })
  ])
])`,
  },
  Repeater: {
    initialDomainData: {
      demo: {
        savedItems: [
          { id: 'saved-a', label: 'Saved item A', note: 'Persisted row from read_state', completed: false },
          { id: 'saved-b', label: 'Saved item B', note: 'Persisted row from read_state', completed: true },
        ],
      },
    },
    source: `$draft = ""
$targetSavedItemId = ""

featuredItems = [
  { label: "Starter card", note: "Local array row" },
  { label: "Second card", note: "Local array row" }
]
savedItems = Query("read_state", { path: "demo.savedItems" }, [])
appendSavedItem = Mutation("append_item", {
  path: "demo.savedItems",
  value: { label: $draft, note: "Persisted row from read_state", completed: false }
})
toggleSavedItem = Mutation("toggle_item_field", {
  path: "demo.savedItems",
  idField: "id",
  id: $targetSavedItemId,
  field: "completed"
})
removeSavedItem = Mutation("remove_item", {
  path: "demo.savedItems",
  idField: "id",
  id: $targetSavedItemId
})
featuredRows = @Each(featuredItems, "item", Group(null, "vertical", [
  Text(item.label, "body", "start"),
  Text(item.note, "muted", "start")
], "inline"))
savedRows = @Each(savedItems, "item", Group(null, "vertical", [
  Group(null, "horizontal", [
    Text(item.label, "body", "start"),
    Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetSavedItemId, item.id), @Run(toggleSavedItem), @Run(savedItems)]))
  ], "inline"),
  Text(item.note, "muted", "start"),
  Button("remove-" + item.id, "Remove", "destructive", Action([@Set($targetSavedItemId, item.id), @Run(removeSavedItem), @Run(savedItems)]), false)
], "inline"))

root = AppShell([
  Screen("main", "Collections", [
    Group("Local array rows", "vertical", [
      Repeater(featuredRows, "No featured items.")
    ]),
    Group("Persisted rows", "vertical", [
      Input("draft", "New item", $draft, "Add saved item"),
      Group(null, "horizontal", [
        Button("append-item", "Append item", "default", Action([@Run(appendSavedItem), @Run(savedItems), @Reset($draft)]), $draft == ""),
        Text("Toggle and remove use top-level item tools plus query refresh.", "muted", "start")
      ], "inline"),
      Repeater(savedRows, "No saved items yet.", { mainColor: "#111827", contrastColor: "#F9FAFB" })
    ])
  ])
])`,
  },
  Text: {
    source: `root = AppShell([
  Screen("main", "Typography", [
    Group("Text variants", "vertical", [
      Text("variant=title: Title copy", "title", "start"),
      Text("variant=body: Body copy explains how the component renders general content.", "body", "start"),
      Text("variant=muted: Muted helper copy", "muted", "start"),
      Text("variant=code: const count = 42", "code", "start"),
      Group("Inline status copy", "horizontal", [
        Text("Saved", "body", "start"),
        Text("just now", "muted", "start")
      ], "inline"),
      Group("Warning surface", "vertical", [
        Text("Please complete all fields.", "body", "start")
      ], "inline", { mainColor: "#FEF3C7", contrastColor: "#92400E" }),
      Text("variant=body: Centered text", "body", "center"),
      Text("variant=body: Right-aligned text", "body", "end")
    ])
  ])
])`,
  },
  Input: {
    source: `$name = "Ada Lovelace"
$email = "ada@example.com"
$dueDate = "2026-04-25"
$quantity = "2"

root = AppShell([
  Screen("main", "Main", [
    Group("Typed inputs", "vertical", [
      Group("Inline profile row", "horizontal", [
        Input("name", "Name", $name, "Ada Lovelace", "Required text input", "text", [{ type: "required", message: "Name is required" }]),
        Input("email", "Email", $email, "ada@example.com", "Email input with validation", "email", [
          { type: "required", message: "Email is required" },
          { type: "email", message: "Enter a valid email" }
        ])
      ], "inline"),
      Group("Inline scheduling row", "horizontal", [
        Input("dueDate", "Due date", $dueDate, "", "Stores YYYY-MM-DD", "date", [{ type: "required", message: "Choose a due date" }]),
        Input("quantity", "Quantity", $quantity, "1", "Stays a string in runtime state", "number", [
          { type: "required", message: "Quantity is required" },
          { type: "minNumber", value: 1, message: "Must be at least 1" },
          { type: "maxNumber", value: 10, message: "Must be no more than 10" }
        ])
      ], "inline"),
      Group("Current values", "horizontal", [
        Text("Name: " + $name, "body", "start"),
        Text("Email: " + $email, "body", "start"),
        Text("Due: " + $dueDate, "body", "start"),
        Text("Qty: " + $quantity, "body", "start")
      ], "inline")
    ])
  ])
])`,
  },
  TextArea: {
    source: `$notes = "This textarea is bound to local reactive state."

root = AppShell([
  Screen("main", "Main", [
    Group("Long-form input", "vertical", [
      TextArea("notes", "Notes", $notes, "Write something longer", "Keep it under 120 characters", [
        { type: "required", message: "Notes are required" },
        { type: "maxLength", value: 120, message: "Keep notes under 120 characters" }
      ]),
      Group("Inline metadata", "horizontal", [
        Text($notes == "" ? "Empty draft" : "Draft ready", "body", "start"),
        Text("Stored in local runtime state", "muted", "start")
      ], "inline")
    ])
  ])
])`,
  },
  Checkbox: {
    initialDomainData: {
      demo: {
        checkboxItems: [
          { id: 'checkbox-a', label: 'Draft tests', completed: false },
          { id: 'checkbox-b', label: 'Ship fix', completed: false },
          { id: 'checkbox-c', label: 'Review docs', completed: false },
          { id: 'checkbox-d', label: 'Verify /elements', completed: false },
          { id: 'checkbox-e', label: 'Publish release', completed: false },
        ],
      },
    },
    source: `$accepted = false
$targetCheckboxItemId = ""

savedItems = Query("read_state", { path: "demo.checkboxItems" }, [])
toggleSavedItem = Mutation("toggle_item_field", {
  path: "demo.checkboxItems",
  idField: "id",
  id: $targetCheckboxItemId,
  field: "completed"
})
savedRows = @Each(savedItems, "item", Group(null, "vertical", [
  Checkbox("toggle-" + item.id, item.label, item.completed, item.completed ? "Persisted row is complete" : "Persisted row is open", null, Action([@Set($targetCheckboxItemId, item.id), @Run(toggleSavedItem), @Run(savedItems)])),
  Text(item.completed ? "Done" : "Open", "muted", "start")
], "inline"))

root = AppShell([
  Screen("main", "Main", [
    Group("Form mode", "vertical", [
      Checkbox("accepted", "I accept the agreement", $accepted, "Required to continue", [
        { type: "required", message: "You must accept the agreement" }
      ]),
      Group("Inline status", "horizontal", [
        Text($accepted ? "Accepted" : "Pending", "body", "start"),
        Text($accepted ? "Ready to continue" : "Review before continuing", "muted", "start")
      ], "inline")
    ]),
    Group("Action mode", "vertical", [
      Text("These rows use display-only checked booleans plus explicit Action([...]) flows.", "muted", "start"),
      Repeater(savedRows, "No persisted checkbox rows.")
    ])
  ])
])`,
  },
  RadioGroup: {
    initialDomainData: {
      demo: {
        radioSettings: {
          plan: 'pro',
        },
      },
    },
    source: `$plan = "pro"

planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" },
  { label: "Enterprise", value: "enterprise" }
]
savedPlan = Query("read_state", { path: "demo.radioSettings.plan" }, "pro")
savePlan = Mutation("write_state", {
  path: "demo.radioSettings.plan",
  value: $lastChoice
})

root = AppShell([
  Screen("main", "Main", [
    Group("Form mode", "vertical", [
      RadioGroup("plan", "Plan", $plan, planOptions, "Choose one plan", [{ type: "required", message: "Pick a plan" }]),
      Group("Inline summary", "horizontal", [
        Text("Selected: " + $plan, "body", "start"),
        Text($plan == "enterprise" ? "High-touch rollout" : "Self-serve setup", "muted", "start")
      ], "inline")
    ]),
    Group("Action mode", "vertical", [
      Text("This radio group persists the newly selected option through runtime-managed $lastChoice.", "muted", "start"),
      RadioGroup("saved-plan", "Persisted plan", savedPlan, planOptions, "Writes the choice through $lastChoice", [], Action([@Run(savePlan), @Run(savedPlan)])),
      Text("Persisted plan: " + savedPlan, "body", "start")
    ])
  ])
])`,
  },
  Select: {
    initialDomainData: {
      demo: {
        selectUi: {
          filter: 'all',
        },
      },
    },
    source: `$frequency = "weekly"
$window = "morning"

frequencyOptions = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" }
]
windowOptions = [
  { label: "Morning", value: "morning" },
  { label: "Afternoon", value: "afternoon" },
  { label: "Evening", value: "evening" }
]
filterOptions = [
  { label: "All tasks", value: "all" },
  { label: "Active tasks", value: "active" },
  { label: "Completed tasks", value: "completed" }
]
savedFilter = Query("read_state", { path: "demo.selectUi.filter" }, "all")
saveFilter = Mutation("write_state", {
  path: "demo.selectUi.filter",
  value: $lastChoice
})
taskCards = [
  { title: "Draft spec", completed: false },
  { title: "Run tests", completed: true },
  { title: "Update docs", completed: false }
]
visibleTaskCards = savedFilter == "completed"
  ? @Filter(taskCards, "completed", "==", true)
  : savedFilter == "active"
    ? @Filter(taskCards, "completed", "==", false)
    : taskCards
taskRows = @Each(visibleTaskCards, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Completed" : "Active", "muted", "start")
], "inline"))

root = AppShell([
  Screen("main", "Main", [
    Group("Form mode", "vertical", [
      Group("Inline scheduling controls", "horizontal", [
        Select("frequency", "Frequency", $frequency, frequencyOptions, "Choose how often to send updates", [
          { type: "required", message: "Choose a frequency" }
        ]),
        Select("window", "Reminder window", $window, windowOptions, "Choose the time of day", [
          { type: "required", message: "Choose a reminder window" }
        ])
      ], "inline"),
      Group("Current values", "horizontal", [
        Text("Frequency: " + $frequency, "body", "start"),
        Text("Window: " + $window, "body", "start")
      ], "inline")
    ]),
    Group("Action mode", "vertical", [
      Text("This select writes the new option into reserved runtime state $lastChoice before the persisted mutation runs.", "muted", "start"),
      Select("saved-filter", "Show", savedFilter, filterOptions, "Persists the filter through $lastChoice", [], Action([@Run(saveFilter), @Run(savedFilter)])),
      Text("Persisted filter: " + savedFilter, "body", "start"),
      Repeater(taskRows, "No matching tasks.")
    ])
  ])
])`,
  },
  Button: {
    source: `$count = 0
$lastModifier = ""

root = AppShell([
  Screen("main", "Main", [
    Group("Variants", "vertical", [
      Text("Clicks: " + $count, "title", "start"),
      Text("Last Modifier: " + $lastModifier, "muted", "start"),
      Group(null, "horizontal", [
        Button("increment", "Increment", "default", Action([@Set($count, $count + 1), @Set($lastModifier, "+")]), false),
        Button("decrease", "Decrease", "secondary", Action([@Set($count, $count - 1), @Set($lastModifier, "-")]), false),
        Button("reset-count", "Reset", "destructive", Action([@Set($count, 0)]), false),
        Button("publish", "Publish", "default", Action([@Set($lastModifier, "publish")]), false, { mainColor: "#FFFFFF", contrastColor: "#2563EB" })
      ], "inline")
    ])
  ])
])`,
  },
  Link: {
    source: `root = AppShell([
  Screen("main", "Main", [
    Group("Anchors", "vertical", [
      Text("Inline link groups stay lightweight inside a block section.", "muted", "start"),
      Group("Inline links", "horizontal", [
        Link("Open OpenAI docs", "https://platform.openai.com/docs", true),
        Link("Open schemas route in the same tab", "/elements", false),
        Link("Email support", "mailto:support@example.com", false)
      ], "inline")
    ])
  ])
])`,
  },
};
