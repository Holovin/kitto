interface ElementDemoDefinition {
  initialDomainData?: Record<string, unknown>;
  initialRuntimeState?: Record<string, unknown>;
  source: string;
}

export const ELEMENT_DEMO_DEFINITIONS: Record<string, ElementDemoDefinition> = {
  AppShell: {
    initialDomainData: {
      navigation: {
        currentScreenId: 'overview',
      },
    },
    source: `showOverview = Mutation("navigate_screen", { screenId: "overview" })
showDetails = Mutation("navigate_screen", { screenId: "details" })

root = AppShell([
  Screen("overview", "Overview", null, [
    Group("Root shell", "vertical", [
      Text("AppShell is a technical wrapper and renders only its children.", "body", "start"),
      Button("show-details", "Show details", "secondary", Action([@Run(showDetails)]), false)
    ])
  ]),
  Screen("details", "Details", null, [
    Group("Nested content", "vertical", [
      Text("Only the active Screen is visible at a time.", "body", "start"),
      Button("show-overview", "Show overview", "secondary", Action([@Run(showOverview)]), false)
    ])
  ])
])`,
  },
  Screen: {
    initialDomainData: {
      navigation: {
        currentScreenId: 'alpha',
      },
    },
    source: `showAlpha = Mutation("navigate_screen", { screenId: "alpha" })
showBeta = Mutation("navigate_screen", { screenId: "beta" })

root = AppShell([
  Screen("alpha", "Alpha", null, [
    Group("First screen", "vertical", [
      Text("Alpha is visible right now.", "body", "start"),
      Button("go-beta", "Go to beta", "default", Action([@Run(showBeta)]), false)
    ])
  ]),
  Screen("beta", "Beta", null, [
    Group("Second screen", "vertical", [
      Text("Beta is active.", "body", "start"),
      Button("go-alpha", "Go to alpha", "secondary", Action([@Run(showAlpha)]), false)
    ])
  ])
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
  Screen("main", "Layout", true, [
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
        items: [{ label: 'Row A' }, { label: 'Row B' }],
      },
    },
    source: `$draft = ""

items = Query("read_state", { path: "demo.items" }, [])
appendItem = Mutation("append_state", { path: "demo.items", value: { label: $draft } })
removeFirstItem = Mutation("remove_state", { path: "demo.items", index: 0 })
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.label, "body", "start")
]))

root = AppShell([
  Screen("main", "Rows", true, [
    Group("Data source", "vertical", [
      Input("draft", "New row", $draft, "Add row"),
      Group(null, "horizontal", [
        Button("append-row", "Append row", "default", Action([@Run(appendItem), @Run(items), @Reset($draft)]), $draft == ""),
        Button("remove-first", "Remove first", "secondary", Action([@Run(removeFirstItem), @Run(items)]), @Count(items) == 0)
      ])
    ]),
    Repeater(rows, "No rows yet.")
  ])
])`,
  },
  Text: {
    source: `root = AppShell([
  Screen("main", "Typography", true, [
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
  Screen("main", "Main", true, [
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
  Screen("main", "Main", true, [
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
  Screen("main", "Main", true, [
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
  Screen("main", "Main", true, [
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
  Screen("main", "Main", true, [
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
  Screen("main", "Main", true, [
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
  Screen("main", "Main", true, [
    Group("Anchors", "vertical", [
      Link("Open OpenAI docs", "https://platform.openai.com/docs", true),
      Link("Open schemas route in the same tab", "/elements", false)
    ])
  ])
])`,
  },
};
