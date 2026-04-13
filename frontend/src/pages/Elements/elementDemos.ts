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

root = AppShell("AppShell demo", [
  Screen("overview", "Overview", null, [
    Group("Root shell", "AppShell wraps the whole generated app and renders active screens below the title.", "vertical", [
      Text("Switch between screens to inspect how the shell behaves.", "body", "start"),
      Button("Show details", "secondary", Action([@Run(showDetails)]), false)
    ])
  ]),
  Screen("details", "Details", null, [
    Group("Nested content", "This is still rendered inside the same AppShell.", "vertical", [
      Text("Only the active Screen is visible at a time.", "body", "start"),
      Button("Show overview", "ghost", Action([@Run(showOverview)]), false)
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

root = AppShell("Screen demo", [
  Screen("alpha", "Alpha", null, [
    Group("First screen", "Toggle which Screen is active through persisted navigation.currentScreenId.", "vertical", [
      Text("Alpha is visible right now.", "body", "start"),
      Button("Go to beta", "default", Action([@Run(showBeta)]), false)
    ])
  ]),
  Screen("beta", "Beta", null, [
    Group("Second screen", "isActive stays optional here; explicit booleans still override this automatic flow.", "vertical", [
      Text("Beta is active.", "body", "start"),
      Button("Go to alpha", "secondary", Action([@Run(showAlpha)]), false)
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

root = AppShell("Group demo", [
  Screen("main", "Layout", true, [
    Group("Vertical group", "Typical stacked form content.", "vertical", [
      Input("name", "Name", $name, "Ada Lovelace", null),
      Select("role", "Role", $role, roleOptions, null)
    ]),
    Group("Horizontal group", "Inline actions align in one row when space allows.", "horizontal", [
      Button("Primary action", "default", Action([@Set($role, "engineer")]), false),
      Button("Secondary action", "secondary", Action([@Set($role, "designer")]), false)
    ]),
    Group("Grid group", "Grid layout is useful for paired fields.", "grid", [
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
rows = @Each(items, "item", Group(null, null, "horizontal", [
  Text(item.label, "body", "start")
]))

root = AppShell("Repeater demo", [
  Screen("main", "Rows", true, [
    Group("Data source", "Append rows to watch Repeater redraw.", "vertical", [
      Input("draft", "New row", $draft, "Add row", null),
      Group(null, null, "horizontal", [
        Button("Append row", "default", Action([@Run(appendItem), @Run(items), @Reset($draft)]), $draft == ""),
        Button("Remove first", "secondary", Action([@Run(removeFirstItem), @Run(items)]), @Count(items) == 0)
      ])
    ]),
    Repeater(rows, "No rows yet.")
  ])
])`,
  },
  Text: {
    source: `root = AppShell("Text demo", [
  Screen("main", "Typography", true, [
    Group("Text variants", "Inspect the supported tones and alignment props.", "vertical", [
      Text("Eyebrow label", "eyebrow", "start"),
      Text("Title copy", "title", "start"),
      Text("Body copy explains how the component renders general content.", "body", "start"),
      Text("Muted helper copy", "muted", "start"),
      Text("const count = 42", "code", "start"),
      Text("Centered text", "body", "center")
    ])
  ])
])`,
  },
  Input: {
    source: `$name = "Ada Lovelace"

root = AppShell("Input demo", [
  Screen("main", "Main", true, [
    Group("Bound field", null, "vertical", [
      Input("name", "Name", $name, "Ada Lovelace", null),
      Text("Current value: " + $name, "body", "start")
    ])
  ])
])`,
  },
  TextArea: {
    source: `$notes = "This textarea is bound to local reactive state."

root = AppShell("TextArea demo", [
  Screen("main", "Main", true, [
    Group("Long-form input", "Type to inspect multiline binding.", "vertical", [
      TextArea("notes", "Notes", $notes, "Write something longer", null),
      Text("Current value: " + $notes, "muted", "start")
    ])
  ])
])`,
  },
  Checkbox: {
    source: `$accepted = false

root = AppShell("Checkbox demo", [
  Screen("main", "Main", true, [
    Group("Toggle", "Checkbox writes boolean state directly.", "vertical", [
      Checkbox("accepted", "I accept the agreement", $accepted, "Toggle me to inspect checked state."),
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

root = AppShell("RadioGroup demo", [
  Screen("main", "Main", true, [
    Group("Single choice", "Pick one option at a time.", "vertical", [
      RadioGroup("plan", "Plan", $plan, planOptions, "Only one value can be active."),
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

root = AppShell("Select demo", [
  Screen("main", "Main", true, [
    Group("Dropdown", "Use Select for compact option sets.", "vertical", [
      Select("frequency", "Frequency", $frequency, frequencyOptions, null),
      Text("Current value: " + $frequency, "body", "start")
    ])
  ])
])`,
  },
  Button: {
    source: `$count = 0

root = AppShell("Button demo", [
  Screen("main", "Main", true, [
    Group("Variants", "Inspect click behavior and variants.", "vertical", [
      Text("Clicks: " + $count, "title", "start"),
      Group(null, null, "horizontal", [
        Button("Increment", "default", Action([@Set($count, $count + 1)]), false),
        Button("Reset", "secondary", Action([@Set($count, 0)]), false),
        Button("Ghost", "ghost", Action([@Set($count, $count + 10)]), false)
      ])
    ])
  ])
])`,
  },
  Link: {
    source: `root = AppShell("Link demo", [
  Screen("main", "Main", true, [
    Group("Anchors", "Inspect the visual treatment of links.", "vertical", [
      Link("Open OpenAI docs", "https://platform.openai.com/docs", true),
      Link("Open schemas route in the same tab", "/elements", false)
    ])
  ])
])`,
  },
};
