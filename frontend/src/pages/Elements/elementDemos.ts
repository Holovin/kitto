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
  ], $currentScreen == "alpha"),
  Screen("beta", "Beta", [
    Group("Second screen", "vertical", [
      Text("Beta is active.", "body", "start"),
      Button("go-alpha", "Go to alpha", "secondary", Action([@Set($currentScreen, "alpha")]), false)
    ])
  ], $currentScreen == "beta")
])`,
  },
  Group: {
    source: `$name = "Ada Lovelace"
$role = "engineer"

roleOptions = [
  { label: "Engineer", value: "engineer" },
  { label: "Designer", value: "designer" }
]

root = AppShell([
  Screen("main", "Layout", [
    Group("Vertical group", "vertical", [
      Input("name", "Name", $name, "Ada Lovelace"),
      Select("role", "Role", $role, roleOptions)
    ]),
    Group("Horizontal group", "horizontal", [
      Button("primary-action", "Primary action", "default", Action([@Set($role, "engineer")]), false),
      Button("secondary-action", "Secondary action", "secondary", Action([@Set($role, "designer")]), false)
    ]),
    Group("Another vertical group", "vertical", [
      Text("Name: " + $name, "body", "start"),
      Text("Role: " + $role, "body", "start")
    ])
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
]))
savedRows = @Each(savedItems, "item", Group(null, "vertical", [
  Text(item.label, "body", "start"),
  Text(item.note, "muted", "start")
]))

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
      ]),
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
      Text("variant=body: Centered text", "body", "center"),
      Text("variant=body: Right-aligned text", "body", "end")
    ])
  ])
])`,
  },
  Input: {
    source: `$name = "Ada Lovelace"

root = AppShell([
  Screen("main", "Main", [
    Group("Bound field", "vertical", [
      Input("name", "Name", $name, "Ada Lovelace"),
      Text("Current value: " + $name, "body", "start")
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
      Text("Current value: " + $notes, "muted", "start")
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
      Text($accepted ? "Accepted" : "Not accepted", "body", "start")
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
      Text("Selected: " + $plan, "body", "start")
    ])
  ])
])`,
  },
  Select: {
    source: `$frequency = "weekly"

frequencyOptions = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" }
]

root = AppShell([
  Screen("main", "Main", [
    Group("Dropdown", "vertical", [
      Select("frequency", "Frequency", $frequency, frequencyOptions),
      Text("Current value: " + $frequency, "body", "start")
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
        Button("reset-count", "Reset", "destructive", Action([@Set($count, 0)]), false)
      ])
    ])
  ])
])`,
  },
  Link: {
    source: `root = AppShell([
  Screen("main", "Main", [
    Group("Anchors", "vertical", [
      Link("Open OpenAI docs", "https://platform.openai.com/docs", true),
      Link("Open schemas route in the same tab", "/elements", false)
    ])
  ])
])`,
  },
};
