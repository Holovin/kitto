interface ElementDemoDefinition {
  initialDomainData?: Record<string, unknown>;
  initialRuntimeState?: Record<string, unknown>;
  source: string;
}

export const ELEMENT_DEMO_DEFINITIONS: Record<string, ElementDemoDefinition> = {
  AppShell: {
    source: `$currentScreen = "overview"

root = AppShell([
  Screen("overview", "Overview", [
    Group("Root shell", "vertical", [
      Text("AppShell is a technical wrapper and renders only its children.", "body", "start"),
      Button("show-details", "Show details", "secondary", Action([@Set($currentScreen, "details")]), false)
    ])
  ], $currentScreen == "overview"),
  Screen("details", "Details", [
    Group("Nested content", "vertical", [
      Text("Only the active Screen is visible at a time.", "body", "start"),
      Button("show-overview", "Show overview", "secondary", Action([@Set($currentScreen, "overview")]), false)
    ])
  ], $currentScreen == "details")
])`,
  },
  Screen: {
    source: `$currentScreen = "alpha"

root = AppShell([
  Screen("alpha", "Alpha", [
    Group("First screen", "vertical", [
      Text("Alpha is visible right now.", "body", "start"),
      Button("go-beta", "Go to beta", "default", Action([@Set($currentScreen, "beta")]), false)
    ])
  ], $currentScreen == "alpha", "#0F172A", "#F8FAFC"),
  Screen("beta", "Beta", [
    Group("Second screen", "vertical", [
      Text("Beta is active.", "body", "start"),
      Button("go-alpha", "Go to alpha", "secondary", Action([@Set($currentScreen, "alpha")]), false)
    ])
  ], $currentScreen == "beta", "#0F172A", "#E0F2FE")
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
      Text("Color overrides support dark-looking sections without exposing raw CSS.", "body", "start", "#F9FAFB"),
      Button("save-dark", "Save changes", "default", Action([@Set($role, "designer")]), false, "#FFFFFF", "#2563EB")
    ], "block", "#F9FAFB", "#111827")
  ])
])`,
  },
  Repeater: {
    initialDomainData: {
      demo: {
        savedItems: [
          { label: 'Saved item A', note: 'Persisted row from read_state' },
          { label: 'Saved item B', note: 'Persisted row from read_state' },
        ],
      },
    },
    source: `$draft = ""

featuredItems = [
  { label: "Starter card", note: "Local array row" },
  { label: "Second card", note: "Local array row" }
]
savedItems = Query("read_state", { path: "demo.savedItems" }, [])
appendSavedItem = Mutation("append_state", {
  path: "demo.savedItems",
  value: { label: $draft, note: "Persisted row from read_state" }
})
removeFirstSavedItem = Mutation("remove_state", { path: "demo.savedItems", index: 0 })
featuredRows = @Each(featuredItems, "item", Group(null, "vertical", [
  Text(item.label, "body", "start"),
  Text(item.note, "muted", "start")
], "inline"))
savedRows = @Each(savedItems, "item", Group(null, "vertical", [
  Text(item.label, "body", "start"),
  Text(item.note, "muted", "start")
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
        Button("remove-first", "Remove first", "secondary", Action([@Run(removeFirstSavedItem), @Run(savedItems)]), @Count(savedItems) == 0)
      ], "inline"),
      Repeater(savedRows, "No saved items yet.")
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
        Text("Please complete all fields.", "body", "start", "#92400E")
      ], "inline", "#92400E", "#FEF3C7"),
      Text("variant=body: Centered text", "body", "center"),
      Text("variant=body: Right-aligned text", "body", "end")
    ])
  ])
])`,
  },
  Input: {
    source: `$name = "Ada Lovelace"
$email = "ada@example.com"

root = AppShell([
  Screen("main", "Main", [
    Group("Bound fields", "vertical", [
      Group("Inline profile row", "horizontal", [
        Input("name", "Name", $name, "Ada Lovelace"),
        Input("email", "Email", $email, "ada@example.com")
      ], "inline"),
      Group("Current values", "horizontal", [
        Text("Name: " + $name, "body", "start"),
        Text("Email: " + $email, "body", "start")
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
      TextArea("notes", "Notes", $notes, "Write something longer"),
      Group("Inline metadata", "horizontal", [
        Text($notes == "" ? "Empty draft" : "Draft ready", "body", "start"),
        Text("Stored in local runtime state", "muted", "start")
      ], "inline")
    ])
  ])
])`,
  },
  Checkbox: {
    source: `$accepted = false

root = AppShell([
  Screen("main", "Main", [
    Group("Toggle", "vertical", [
      Checkbox("accepted", "I accept the agreement", $accepted),
      Group("Inline status", "horizontal", [
        Text($accepted ? "Accepted" : "Pending", "body", "start"),
        Text($accepted ? "Ready to continue" : "Review before continuing", "muted", "start")
      ], "inline")
    ])
  ])
])`,
  },
  RadioGroup: {
    source: `$plan = "pro"

planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" },
  { label: "Enterprise", value: "enterprise" }
]

root = AppShell([
  Screen("main", "Main", [
    Group("Single choice", "vertical", [
      RadioGroup("plan", "Plan", $plan, planOptions),
      Group("Inline summary", "horizontal", [
        Text("Selected: " + $plan, "body", "start"),
        Text($plan == "enterprise" ? "High-touch rollout" : "Self-serve setup", "muted", "start")
      ], "inline")
    ])
  ])
])`,
  },
  Select: {
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

root = AppShell([
  Screen("main", "Main", [
    Group("Dropdowns", "vertical", [
      Group("Inline scheduling controls", "horizontal", [
        Select("frequency", "Frequency", $frequency, frequencyOptions),
        Select("window", "Reminder window", $window, windowOptions)
      ], "inline"),
      Group("Current values", "horizontal", [
        Text("Frequency: " + $frequency, "body", "start"),
        Text("Window: " + $window, "body", "start")
      ], "inline")
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
        Button("publish", "Publish", "default", Action([@Set($lastModifier, "publish")]), false, "#FFFFFF", "#2563EB")
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
