interface BuilderDemoPreset {
  description: string;
  domainData: Record<string, unknown>;
  id: string;
  label: string;
  source: string;
}

const animalExplorerDemoSource = `$currentScreenTop = "screen1"
$currentScreenBottom = "screen3"
$currentTheme = "light"

lightTheme = { mainColor: "#FFFFFF", contrastColor: "#111827" }
darkTheme = { mainColor: "#111827", contrastColor: "#F9FAFB" }
appTheme = $currentTheme == "dark" ? darkTheme : lightTheme
activeThemeButton = { mainColor: "#111827", contrastColor: "#FFFFFF" }
inactiveThemeButton = { mainColor: "#FFFFFF", contrastColor: "#111827" }
activeAnimalButton = { mainColor: "#2563EB", contrastColor: "#FFFFFF" }
inactiveAnimalButton = { mainColor: "#DBEAFE", contrastColor: "#1E3A8A" }
activeFishButton = { mainColor: "#0F766E", contrastColor: "#FFFFFF" }
inactiveFishButton = { mainColor: "#CCFBF1", contrastColor: "#115E59" }

root = AppShell([
  Group(null, "horizontal", [
    Button("theme-light", "Light", "default", Action([@Set($currentTheme, "light")]), false, $currentTheme == "light" ? activeThemeButton : inactiveThemeButton),
    Button("theme-dark", "Dark", "default", Action([@Set($currentTheme, "dark")]), false, $currentTheme == "dark" ? activeThemeButton : inactiveThemeButton)
  ], "inline"),
  Screen("screen1", "Animals", [
    Group(null, "horizontal", [
      Button("go-screen1", "Cat", "default", Action([@Set($currentScreenTop, "screen1")]), false, $currentScreenTop == "screen1" ? activeAnimalButton : inactiveAnimalButton),
      Button("go-screen2", "Dog", "secondary", Action([@Set($currentScreenTop, "screen2")]), false, $currentScreenTop == "screen2" ? activeAnimalButton : inactiveAnimalButton)
    ], "inline"),
    Text("Cat", "title", "center"),
    Text("A cat is a domestic animal that likes warmth, soft places, and living close to people.", "body", "center")
  ], $currentScreenTop == "screen1"),
  Screen("screen2", "Animals", [
    Group(null, "horizontal", [
      Button("go-screen1b", "Cat", "secondary", Action([@Set($currentScreenTop, "screen1")]), false, $currentScreenTop == "screen1" ? activeAnimalButton : inactiveAnimalButton),
      Button("go-screen2b", "Dog", "default", Action([@Set($currentScreenTop, "screen2")]), false, $currentScreenTop == "screen2" ? activeAnimalButton : inactiveAnimalButton)
    ], "inline"),
    Text("Dog", "title", "center"),
    Text("A dog is a loyal human companion. It learns commands well, enjoys walks, and helps guard the home.", "body", "center")
  ], $currentScreenTop == "screen2"),
  Screen("screen3", "Fish", [
    Group(null, "horizontal", [
      Button("go-screen3c", "Perch", "default", Action([@Set($currentScreenBottom, "screen3")]), false, $currentScreenBottom == "screen3" ? activeFishButton : inactiveFishButton),
      Button("go-screen4c", "Pike", "secondary", Action([@Set($currentScreenBottom, "screen4")]), false, $currentScreenBottom == "screen4" ? activeFishButton : inactiveFishButton),
      Button("go-screen5c", "Crucian carp", "secondary", Action([@Set($currentScreenBottom, "screen5")]), false, $currentScreenBottom == "screen5" ? activeFishButton : inactiveFishButton)
    ], "inline"),
    Text("Perch", "title", "center"),
    Text("Perch is a freshwater fish with striped coloring. It lives in rivers and lakes and feeds on small fish and insects.", "body", "center")
  ], $currentScreenBottom == "screen3"),
  Screen("screen4", "Fish", [
    Group(null, "horizontal", [
      Button("go-screen3d", "Perch", "secondary", Action([@Set($currentScreenBottom, "screen3")]), false, $currentScreenBottom == "screen3" ? activeFishButton : inactiveFishButton),
      Button("go-screen4d", "Pike", "default", Action([@Set($currentScreenBottom, "screen4")]), false, $currentScreenBottom == "screen4" ? activeFishButton : inactiveFishButton),
      Button("go-screen5d", "Crucian carp", "secondary", Action([@Set($currentScreenBottom, "screen5")]), false, $currentScreenBottom == "screen5" ? activeFishButton : inactiveFishButton)
    ], "inline"),
    Text("Pike", "title", "center"),
    Text("Pike is a predatory fish with a long body and sharp teeth. It hides in reeds and hunts from ambush.", "body", "center")
  ], $currentScreenBottom == "screen4"),
  Screen("screen5", "Fish", [
    Group(null, "horizontal", [
      Button("go-screen3e", "Perch", "secondary", Action([@Set($currentScreenBottom, "screen3")]), false, $currentScreenBottom == "screen3" ? activeFishButton : inactiveFishButton),
      Button("go-screen4e", "Pike", "secondary", Action([@Set($currentScreenBottom, "screen4")]), false, $currentScreenBottom == "screen4" ? activeFishButton : inactiveFishButton),
      Button("go-screen5e", "Crucian carp", "default", Action([@Set($currentScreenBottom, "screen5")]), false, $currentScreenBottom == "screen5" ? activeFishButton : inactiveFishButton)
    ], "inline"),
    Text("Crucian carp", "title", "center"),
    Text("Crucian carp is a hardy fish that can live even in calm, warm waters. It is often found in ponds and lakes.", "body", "center")
  ], $currentScreenBottom == "screen5")
], appTheme)`;

const todoDemoSource = `$taskTitle = ""
$filter = "all"
$targetTaskId = ""

tasks = Query("read_state", { path: "app.tasks" }, [])
visibleTasks = $filter == "completed" ? @Filter(tasks, "completed", "==", true) : $filter == "active" ? @Filter(tasks, "completed", "==", false) : tasks
createTask = Mutation("append_item", {
  path: "app.tasks",
  value: { title: $taskTitle, completed: false }
})
toggleTask = Mutation("toggle_item_field", {
  path: "app.tasks",
  idField: "id",
  id: $targetTaskId,
  field: "completed"
})
taskRows = @Each(visibleTasks, "task", Group(null, "horizontal", [
  Text(task.title, "title", "start"),
  Checkbox("completed-" + task.id, "", task.completed, null, null, Action([@Set($targetTaskId, task.id), @Run(toggleTask), @Run(tasks)]))
], "inline"))
filterOptions = [
  { value: "all", label: "All tasks" },
  { value: "active", label: "Active only" },
  { value: "completed", label: "Completed only" }
]
root = AppShell([
  Screen("main", "Task builder", [
    Group("Compose", "vertical", [
      Input("taskTitle", "Task title", $taskTitle, "Create a todo list"),
      Button("add-task", "Add task", "default", Action([@Run(createTask), @Run(tasks), @Reset($taskTitle)]), false)
    ]),
    Group("Live preview", "vertical", [
      Select("filter", "Filter", $filter, filterOptions),
      Text("Tasks in storage: " + @Count(tasks), "muted", "start"),
      Repeater(taskRows, "Nothing here yet. Add a task from the composer above.")
    ])
  ])
])`;

const quizDemoSource = `$answer1 = ""
$answer2 = ""
$answer3 = ""
$agreement = false
$currentScreen = "intro"

capitalOptions = [
  { label: "Paris", value: "Paris" },
  { label: "Rome", value: "Rome" },
  { label: "Berlin", value: "Berlin" }
]
reactOptions = [
  { label: "Hooks", value: "Hooks" },
  { label: "Serverless", value: "Serverless" },
  { label: "Bundles", value: "Bundles" }
]
stateOptions = [
  { label: "write_state(path, value)", value: "write_state" },
  { label: "merge_state(path, patch)", value: "merge_state" },
  { label: "remove_state(path, index)", value: "remove_state" }
]
score = ($answer1 == "Paris" ? 1 : 0) + ($answer2 == "Hooks" ? 1 : 0) + ($answer3 == "write_state" ? 1 : 0)
selectedAnswers = [
  { label: "Capital of France", value: $answer1 },
  { label: "React feature", value: $answer2 },
  { label: "Persisted write operation", value: $answer3 }
]
answerRows = @Each(selectedAnswers, "answer", Group(null, "vertical", [
  Text(answer.label, "muted", "start"),
  Text(answer.value == "" ? "Not answered yet." : answer.value, "body", "start")
], "inline"))

root = AppShell([
  Screen("intro", "Welcome", [
    Group("How it works", "vertical", [
      Text("Answer three questions and accept the agreement before submit.", "body", "start"),
      Button("start-quiz", "Start quiz", "default", Action([@Set($currentScreen, "q1")]), false)
    ])
  ], $currentScreen == "intro"),
  Screen("q1", "Question 1", [
    RadioGroup("answer1", "Which city is the capital of France?", $answer1, capitalOptions),
    Group(null, "horizontal", [
      Button("next-q1", "Next", "default", Action([@Set($currentScreen, "q2")]), $answer1 == ""),
      Button("back-q1", "Back", "secondary", Action([@Set($currentScreen, "intro")]), false)
    ], "inline")
  ], $currentScreen == "q1"),
  Screen("q2", "Question 2", [
    RadioGroup("answer2", "Which feature made local React state easier?", $answer2, reactOptions),
    Group(null, "horizontal", [
      Button("next-q2", "Next", "default", Action([@Set($currentScreen, "q3")]), $answer2 == ""),
      Button("back-q2", "Back", "secondary", Action([@Set($currentScreen, "q1")]), false)
    ], "inline")
  ], $currentScreen == "q2"),
  Screen("q3", "Question 3", [
    RadioGroup("answer3", "Which operation writes a scalar value into persisted state?", $answer3, stateOptions),
    Group(null, "horizontal", [
      Button("next-q3", "Next", "default", Action([@Set($currentScreen, "agreement")]), $answer3 == ""),
      Button("back-q3", "Back", "secondary", Action([@Set($currentScreen, "q2")]), false)
    ], "inline")
  ], $currentScreen == "q3"),
  Screen("agreement", "Agreement", [
    Checkbox("agreement", "I confirm that I reviewed all answers before submit.", $agreement),
    Group(null, "horizontal", [
      Button("show-result", "Show result", "default", Action([@Set($currentScreen, "result")]), !$agreement),
      Button("back-agreement", "Back", "secondary", Action([@Set($currentScreen, "q3")]), false)
    ], "inline")
  ], $currentScreen == "agreement"),
  Screen("result", "Result", [
    Group("Score", "vertical", [
      Text(score + " / 3", "title", "start"),
      Text(score == 3 ? "Perfect score." : score == 2 ? "Almost there." : "Try another round.", "body", "start"),
      Button("restart-quiz", "Restart", "destructive", Action([@Set($currentScreen, "intro"), @Reset($answer1, $answer2, $answer3, $agreement)]), false)
    ]),
    Group("Selected answers", "vertical", [
      Repeater(answerRows, "No answers selected yet.")
    ])
  ], $currentScreen == "result")
])`;

const agreementDemoSource = `$name = ""
$email = ""
$accepted = false

submissions = Query("read_state", { path: "app.submissions" }, [])
createSubmission = Mutation("append_state", {
  path: "app.submissions",
  value: { name: $name, email: $email, accepted: true }
})
rows = @Each(submissions, "submission", Group(null, "vertical", [
  Text(submission.name, "title", "start"),
  Text(submission.email, "muted", "start")
], "inline"))

root = AppShell([
  Screen("main", "Signup", [
    Group("Form", "vertical", [
      Input("name", "Full name", $name, "Alex Johnson", "Required", "text", [{ type: "required", message: "Name is required" }]),
      Input("email", "Email", $email, "alex@example.com", "Required email", "email", [
        { type: "required", message: "Email is required" },
        { type: "email", message: "Enter a valid email" }
      ]),
      Checkbox("accepted", "I agree to the terms before submit.", $accepted, "Required agreement", [
        { type: "required", message: "You must accept the agreement" }
      ]),
      Group(null, "horizontal", [
        Button("submit-form", "Submit", "default", Action([@Run(createSubmission), @Run(submissions), @Reset($name, $email, $accepted)]), !$accepted || $name == "" || $email == ""),
        Link("Privacy policy", "https://platform.openai.com/docs", true)
      ], "inline")
    ]),
    Group("Saved submissions", "vertical", [
      Text("Total saved: " + @Count(submissions), "muted", "start"),
      Repeater(rows, "No submissions yet.")
    ])
  ])
])`;

export const BUILDER_DEMO_PRESETS: BuilderDemoPreset[] = [
  {
    id: 'animal-explorer-demo',
    label: 'Animal explorer',
    description: 'Five-screen animal explorer with a light/dark toggle and fish detail tabs.',
    source: animalExplorerDemoSource,
    domainData: {},
  },
  {
    id: 'todo-demo',
    label: 'Todo board',
    description: 'Todo list with filtering and a persisted collection.',
    source: todoDemoSource,
    domainData: {
      app: {
        tasks: [
          {
            id: 'task-1',
            title: 'Draft the onboarding flow',
            completed: false,
          },
          {
            id: 'task-2',
            title: 'Review the launch checklist',
            completed: true,
          },
        ],
      },
    },
  },
  {
    id: 'quiz-demo',
    label: 'Quiz flow',
    description: 'Three questions, radio buttons, next buttons, agreement gating, and a result screen.',
    source: quizDemoSource,
    domainData: {},
  },
  {
    id: 'agreement-demo',
    label: 'Agreement form',
    description: 'Text inputs, checkbox agreement, submit action, and a persisted submissions list.',
    source: agreementDemoSource,
    domainData: {
      app: {
        submissions: [
          {
            name: 'Alex Johnson',
            email: 'alex@example.com',
            accepted: true,
          },
        ],
      },
    },
  },
];
