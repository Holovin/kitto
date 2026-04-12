export interface BuilderDemoPreset {
  description: string;
  domainData: Record<string, unknown>;
  id: string;
  label: string;
  source: string;
}

const todoDemoSource = `$taskTitle = ""
$dueDate = ""
$filter = "all"

tasks = Query("read_state", { path: "app.tasks" }, [])
visibleTasks = $filter == "completed" ? @Filter(tasks, "completed", "==", true) : $filter == "active" ? @Filter(tasks, "completed", "==", false) : tasks
createTask = Mutation("append_state", {
  path: "app.tasks",
  value: { title: $taskTitle, dueDate: $dueDate, completed: false }
})
docsLink = Mutation("open_url", { url: "https://platform.openai.com/docs" })
taskRows = @Each(visibleTasks, "task", Group(null, null, "vertical", [
  Text(task.title, "title"),
  Text(task.dueDate == "" ? "No due date yet" : "Due: " + task.dueDate, "muted"),
  Checkbox("completed-" + task.title, "Completed", task.completed, "Preview state is persisted locally.")
]))
filterOptions = [
  { value: "all", label: "All tasks" },
  { value: "active", label: "Active only" },
  { value: "completed", label: "Completed only" }
]
root = AppShell("Starter task board", "Todo demo with due dates, filtering, local persistence, and collection rendering.", [
  Screen("main", "Task builder", true, [
    Group("Compose", "These controls write into local persisted browser state.", "vertical", [
      Input("taskTitle", "Task title", $taskTitle, "Create a todo list", null),
      Input("dueDate", "Due date", $dueDate, "YYYY-MM-DD", null),
      Select("filter", "Filter", $filter, filterOptions, "Allow filtering by completed"),
      Group(null, null, "horizontal", [
        Button("Add task", "default", Action([@Run(createTask), @Run(tasks), @Reset($taskTitle, $dueDate)]), false),
        Button("Open OpenAI docs", "secondary", Action([@Run(docsLink)]), false)
      ])
    ]),
    Group("Live preview", "The list below is rendered from Query(read_state).", "vertical", [
      Text("Tasks in storage: " + @Count(tasks), "muted", "start"),
      Repeater(taskRows, "Nothing here yet. Add a task from the composer above.")
    ])
  ])
])`;

const quizDemoSource = `$screen = "intro"
$answer1 = ""
$answer2 = ""
$answer3 = ""
$agreement = false

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
  { label: "open_url(url)", value: "open_url" },
  { label: "remove_state(path, index)", value: "remove_state" }
]
score = ($answer1 == "Paris" ? 1 : 0) + ($answer2 == "Hooks" ? 1 : 0) + ($answer3 == "write_state" ? 1 : 0)

root = AppShell("Quiz demo", "Three questions, radio buttons, next buttons, an agreement step, and a result screen.", [
  Screen("intro", "Welcome", $screen == "intro", [
    Group("How it works", "This demo shows screen flow without using the app router.", "vertical", [
      Text("Answer three questions and accept the agreement before submit.", "body", "start"),
      Button("Start quiz", "default", Action([@Set($screen, "q1")]), false)
    ])
  ]),
  Screen("q1", "Question 1", $screen == "q1", [
    RadioGroup("answer1", "Which city is the capital of France?", $answer1, capitalOptions, null),
    Group(null, null, "horizontal", [
      Button("Next", "default", Action([@Set($screen, "q2")]), $answer1 == ""),
      Button("Back", "ghost", Action([@Set($screen, "intro")]), false)
    ])
  ]),
  Screen("q2", "Question 2", $screen == "q2", [
    RadioGroup("answer2", "Which feature made local React state easier?", $answer2, reactOptions, null),
    Group(null, null, "horizontal", [
      Button("Next", "default", Action([@Set($screen, "q3")]), $answer2 == ""),
      Button("Back", "ghost", Action([@Set($screen, "q1")]), false)
    ])
  ]),
  Screen("q3", "Question 3", $screen == "q3", [
    RadioGroup("answer3", "Which operation writes a scalar value into persisted state?", $answer3, stateOptions, null),
    Group(null, null, "horizontal", [
      Button("Next", "default", Action([@Set($screen, "agreement")]), $answer3 == ""),
      Button("Back", "ghost", Action([@Set($screen, "q2")]), false)
    ])
  ]),
  Screen("agreement", "Agreement", $screen == "agreement", [
    Checkbox("agreement", "I confirm that I reviewed all answers before submit.", $agreement, "A checkbox gate before the last action."),
    Group(null, null, "horizontal", [
      Button("Show result", "default", Action([@Set($screen, "result")]), !$agreement),
      Button("Back", "ghost", Action([@Set($screen, "q3")]), false)
    ])
  ]),
  Screen("result", "Result", $screen == "result", [
    Group("Score", "Conditional rendering and local state stay inside the generated app.", "vertical", [
      Text(score + " / 3", "title", "start"),
      Text(score == 3 ? "Perfect score." : score == 2 ? "Almost there." : "Try another round.", "body", "start"),
      Button("Restart", "secondary", Action([@Reset($answer1, $answer2, $answer3, $agreement), @Set($screen, "intro")]), false)
    ])
  ])
])`;

const agreementDemoSource = `$name = ""
$email = ""
$accepted = false

submissions = Query("read_state", { path: "app.submissions" }, [])
createSubmission = Mutation("append_state", {
  path: "app.submissions",
  value: { name: $name, email: $email, accepted: true }
})
rows = @Each(submissions, "submission", Group(null, null, "vertical", [
  Text(submission.name, "title", "start"),
  Text(submission.email, "muted", "start")
]))

root = AppShell("Agreement form demo", "Text fields, checkbox agreement, persistence, and a live submissions list.", [
  Screen("main", "Signup", true, [
    Group("Form", "A small flow that requires checkbox agreement before submit.", "vertical", [
      Input("name", "Full name", $name, "Alex Johnson", null),
      Input("email", "Email", $email, "alex@example.com", null),
      Checkbox("accepted", "I agree to the terms before submit.", $accepted, "Submit stays disabled until the checkbox is checked."),
      Group(null, null, "horizontal", [
        Button("Submit", "default", Action([@Run(createSubmission), @Run(submissions), @Reset($name, $email, $accepted)]), !$accepted || $name == "" || $email == ""),
        Link("Privacy policy", "https://platform.openai.com/docs", true)
      ])
    ]),
    Group("Saved submissions", "Persisted browser data rendered back through Query(read_state).", "vertical", [
      Text("Total saved: " + @Count(submissions), "muted", "start"),
      Repeater(rows, "No submissions yet.")
    ])
  ])
])`;

export const BUILDER_DEMO_PRESETS: BuilderDemoPreset[] = [
  {
    id: 'todo-demo',
    label: 'Todo board',
    description: 'Todo list with due dates, filtering, and a persisted collection.',
    source: todoDemoSource,
    domainData: {
      app: {
        tasks: [
          {
            title: 'Draft the onboarding flow',
            dueDate: '2026-04-18',
            completed: false,
          },
          {
            title: 'Review the launch checklist',
            dueDate: '2026-04-20',
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
