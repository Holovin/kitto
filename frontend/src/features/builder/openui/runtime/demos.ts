interface BuilderDemoPreset {
  description: string;
  domainData: Record<string, unknown>;
  id: string;
  label: string;
  source: string;
}

const todoDemoSource = `$taskTitle = ""
$filter = "all"

tasks = Query("read_state", { path: "app.tasks" }, [])
visibleTasks = $filter == "completed" ? @Filter(tasks, "completed", "==", true) : $filter == "active" ? @Filter(tasks, "completed", "==", false) : tasks
createTask = Mutation("append_state", {
  path: "app.tasks",
  value: { title: $taskTitle, completed: false }
})
taskRows = @Each(visibleTasks, "task", Group(null, "vertical", [
  Text(task.title, "title"),
  Checkbox("completed-" + task.title, "Completed", task.completed)
]))
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
]))

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
    ])
  ], $currentScreen == "q1"),
  Screen("q2", "Question 2", [
    RadioGroup("answer2", "Which feature made local React state easier?", $answer2, reactOptions),
    Group(null, "horizontal", [
      Button("next-q2", "Next", "default", Action([@Set($currentScreen, "q3")]), $answer2 == ""),
      Button("back-q2", "Back", "secondary", Action([@Set($currentScreen, "q1")]), false)
    ])
  ], $currentScreen == "q2"),
  Screen("q3", "Question 3", [
    RadioGroup("answer3", "Which operation writes a scalar value into persisted state?", $answer3, stateOptions),
    Group(null, "horizontal", [
      Button("next-q3", "Next", "default", Action([@Set($currentScreen, "agreement")]), $answer3 == ""),
      Button("back-q3", "Back", "secondary", Action([@Set($currentScreen, "q2")]), false)
    ])
  ], $currentScreen == "q3"),
  Screen("agreement", "Agreement", [
    Checkbox("agreement", "I confirm that I reviewed all answers before submit.", $agreement),
    Group(null, "horizontal", [
      Button("show-result", "Show result", "default", Action([@Set($currentScreen, "result")]), !$agreement),
      Button("back-agreement", "Back", "secondary", Action([@Set($currentScreen, "q3")]), false)
    ])
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
]))

root = AppShell([
  Screen("main", "Signup", [
    Group("Form", "vertical", [
      Input("name", "Full name", $name, "Alex Johnson"),
      Input("email", "Email", $email, "alex@example.com"),
      Checkbox("accepted", "I agree to the terms before submit.", $accepted),
      Group(null, "horizontal", [
        Button("submit-form", "Submit", "default", Action([@Run(createSubmission), @Run(submissions), @Reset($name, $email, $accepted)]), !$accepted || $name == "" || $email == ""),
        Link("Privacy policy", "https://platform.openai.com/docs", true)
      ])
    ]),
    Group("Saved submissions", "vertical", [
      Text("Total saved: " + @Count(submissions), "muted", "start"),
      Repeater(rows, "No submissions yet.")
    ])
  ])
])`;

export const BUILDER_DEMO_PRESETS: BuilderDemoPreset[] = [
  {
    id: 'todo-demo',
    label: 'Todo board',
    description: 'Todo list with filtering and a persisted collection.',
    source: todoDemoSource,
    domainData: {
      app: {
        tasks: [
          {
            title: 'Draft the onboarding flow',
            completed: false,
          },
          {
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
