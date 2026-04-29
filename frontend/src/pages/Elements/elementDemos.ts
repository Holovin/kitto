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
activeThemeButton = { mainColor: "#DC2626", contrastColor: "#FFFFFF" }

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
        Input("layoutName", "Name", $name, "Ada Lovelace"),
        Input("layoutEmail", "Email", $email, "ada@example.com")
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
      Button("save-dark", "Save changes", "default", Action([@Set($role, "designer")]), false, { mainColor: "#2563EB", contrastColor: "#FFFFFF" })
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
        radioSettings: [
          { id: 'radio-a', label: 'Workspace A', plan: 'pro' },
          { id: 'radio-b', label: 'Workspace B', plan: 'starter' },
        ],
      },
    },
    source: `$plan = "pro"
$targetRadioSettingId = ""

planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" },
  { label: "Enterprise", value: "enterprise" }
]
savedPlans = Query("read_state", { path: "demo.radioSettings" }, [])
savePlan = Mutation("update_item_field", {
  path: "demo.radioSettings",
  idField: "id",
  id: $targetRadioSettingId,
  field: "plan",
  value: $lastChoice
})
savedPlanRows = @Each(savedPlans, "item", Group(null, "vertical", [
  RadioGroup("saved-plan-" + item.id, item.label, item.plan, planOptions, "Writes the choice through $lastChoice into this persisted row", [], Action([@Set($targetRadioSettingId, item.id), @Run(savePlan), @Run(savedPlans)])),
  Text("Persisted plan: " + item.plan, "body", "start")
], "inline"))

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
      Text("Each repeated row persists its choice through runtime-managed $lastChoice plus an explicit collection update.", "muted", "start"),
      Repeater(savedPlanRows, "No persisted plan rows.")
    ])
  ])
])`,
  },
  Select: {
    initialDomainData: {
      demo: {
        selectViews: [
          { id: 'select-a', label: 'Inbox board', filter: 'all' },
          { id: 'select-b', label: 'Launch board', filter: 'active' },
        ],
      },
    },
    source: `$frequency = "weekly"
$window = "morning"
$targetSelectViewId = ""

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
savedViews = Query("read_state", { path: "demo.selectViews" }, [])
saveViewFilter = Mutation("update_item_field", {
  path: "demo.selectViews",
  idField: "id",
  id: $targetSelectViewId,
  field: "filter",
  value: $lastChoice
})
savedViewRows = @Each(savedViews, "item", Group(null, "vertical", [
  Text(item.label, "muted", "start"),
  Select("saved-filter-" + item.id, "Show", item.filter, filterOptions, "Persists the filter through $lastChoice into this row", [], Action([@Set($targetSelectViewId, item.id), @Run(saveViewFilter), @Run(savedViews)])),
  Text("Persisted filter: " + item.filter, "body", "start"),
  Text(item.filter == "completed" ? "Showing completed tasks" : item.filter == "active" ? "Showing active tasks" : "Showing all tasks", "muted", "start")
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
      Text("Each repeated row writes the new option into reserved runtime state $lastChoice before the persisted collection mutation runs.", "muted", "start"),
      Repeater(savedViewRows, "No persisted filter rows.")
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
        Button("publish", "Publish", "default", Action([@Set($lastModifier, "publish")]), false, { mainColor: "#2563EB", contrastColor: "#FFFFFF" })
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
        Link("Open examples catalog", "https://example.com/elements", false),
        Link("Open support", "https://example.com/support", false)
      ], "inline")
    ])
  ])
])`,
  },
};
