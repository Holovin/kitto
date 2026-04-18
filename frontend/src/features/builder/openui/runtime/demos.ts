interface BuilderDemoPreset {
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
taskRows = @Each(visibleTasks, "task", Group(null, "vertical", [
  Text(task.title, "title"),
  Text(task.dueDate == "" ? "No due date yet" : "Due: " + task.dueDate, "muted"),
  Checkbox("completed-" + task.title, "Completed", task.completed)
]))
filterOptions = [
  { value: "all", label: "All tasks" },
  { value: "active", label: "Active only" },
  { value: "completed", label: "Completed only" }
]
root = AppShell([
  Screen("main", "Task builder", true, [
    Group("Compose", "vertical", [
      Input("taskTitle", "Task title", $taskTitle, "Create a todo list"),
      Input("dueDate", "Due date", $dueDate, "YYYY-MM-DD"),
      Select("filter", "Filter", $filter, filterOptions),
      Button("add-task", "Add task", "default", Action([@Run(createTask), @Run(tasks), @Reset($taskTitle, $dueDate)]), false)
    ]),
    Group("Live preview", "vertical", [
      Text("Tasks in storage: " + @Count(tasks), "muted", "start"),
      Repeater(taskRows, "Nothing here yet. Add a task from the composer above.")
    ])
  ])
])`;

const quizDemoSource = `$answer1 = ""
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
  { label: "merge_state(path, patch)", value: "merge_state" },
  { label: "remove_state(path, index)", value: "remove_state" }
]
goIntro = Mutation("navigate_screen", { screenId: "intro" })
goQ1 = Mutation("navigate_screen", { screenId: "q1" })
goQ2 = Mutation("navigate_screen", { screenId: "q2" })
goQ3 = Mutation("navigate_screen", { screenId: "q3" })
goAgreement = Mutation("navigate_screen", { screenId: "agreement" })
goResult = Mutation("navigate_screen", { screenId: "result" })
score = ($answer1 == "Paris" ? 1 : 0) + ($answer2 == "Hooks" ? 1 : 0) + ($answer3 == "write_state" ? 1 : 0)

root = AppShell([
  Screen("intro", "Welcome", null, [
    Group("How it works", "vertical", [
      Text("Answer three questions and accept the agreement before submit.", "body", "start"),
      Button("start-quiz", "Start quiz", "default", Action([@Run(goQ1)]), false)
    ])
  ]),
  Screen("q1", "Question 1", null, [
    RadioGroup("answer1", "Which city is the capital of France?", $answer1, capitalOptions),
    Group(null, "horizontal", [
      Button("next-q1", "Next", "default", Action([@Run(goQ2)]), $answer1 == ""),
      Button("back-q1", "Back", "secondary", Action([@Run(goIntro)]), false)
    ])
  ]),
  Screen("q2", "Question 2", null, [
    RadioGroup("answer2", "Which feature made local React state easier?", $answer2, reactOptions),
    Group(null, "horizontal", [
      Button("next-q2", "Next", "default", Action([@Run(goQ3)]), $answer2 == ""),
      Button("back-q2", "Back", "secondary", Action([@Run(goQ1)]), false)
    ])
  ]),
  Screen("q3", "Question 3", null, [
    RadioGroup("answer3", "Which operation writes a scalar value into persisted state?", $answer3, stateOptions),
    Group(null, "horizontal", [
      Button("next-q3", "Next", "default", Action([@Run(goAgreement)]), $answer3 == ""),
      Button("back-q3", "Back", "secondary", Action([@Run(goQ2)]), false)
    ])
  ]),
  Screen("agreement", "Agreement", null, [
    Checkbox("agreement", "I confirm that I reviewed all answers before submit.", $agreement),
    Group(null, "horizontal", [
      Button("show-result", "Show result", "default", Action([@Run(goResult)]), !$agreement),
      Button("back-agreement", "Back", "secondary", Action([@Run(goQ3)]), false)
    ])
  ]),
  Screen("result", "Result", null, [
    Group("Score", "vertical", [
      Text(score + " / 3", "title", "start"),
      Text(score == 3 ? "Perfect score." : score == 2 ? "Almost there." : "Try another round.", "body", "start"),
      Button("restart-quiz", "Restart", "destructive", Action([@Reset($answer1, $answer2, $answer3, $agreement), @Run(goIntro)]), false)
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
rows = @Each(submissions, "submission", Group(null, "vertical", [
  Text(submission.name, "title", "start"),
  Text(submission.email, "muted", "start")
]))

root = AppShell([
  Screen("main", "Signup", true, [
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
    domainData: {
      navigation: {
        currentScreenId: 'intro',
      },
    },
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
