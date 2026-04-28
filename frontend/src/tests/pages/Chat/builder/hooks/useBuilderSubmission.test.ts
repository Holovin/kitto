import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { ChangeEvent, FormEvent } from 'react';

const testHarness = vi.hoisted(() => {
  type Cleanup = void | (() => void);

  const activeRuntimeRef = { current: null as HookRuntime | null };

  class HookRuntime {
    cursor = 0;
    effectStates: Array<{ cleanup?: Cleanup; deps?: unknown[] }> = [];
    hookValues: unknown[] = [];
    pendingEffects: Array<() => void> = [];

    render<Result>(callback: () => Result) {
      this.cursor = 0;
      this.pendingEffects = [];
      activeRuntimeRef.current = this;

      try {
        return callback();
      } finally {
        activeRuntimeRef.current = null;

        for (const runEffect of this.pendingEffects) {
          runEffect();
        }

        this.pendingEffects = [];
      }
    }

    unmount() {
      for (const effectState of this.effectStates) {
        if (typeof effectState?.cleanup === 'function') {
          effectState.cleanup();
        }
      }

      this.effectStates = [];
      this.hookValues = [];
      this.pendingEffects = [];
      this.cursor = 0;
    }

    useCallback<Callback extends (...args: never[]) => unknown>(callback: Callback, deps?: unknown[]) {
      const index = this.cursor;
      this.cursor += 1;

      const previous = this.hookValues[index] as { callback: Callback; deps?: unknown[] } | undefined;
      const hasChanged =
        !previous ||
        !deps ||
        !previous.deps ||
        deps.length !== previous.deps.length ||
        deps.some((value, depIndex) => !Object.is(value, previous.deps?.[depIndex]));

      if (!hasChanged) {
        return previous.callback;
      }

      this.hookValues[index] = {
        callback,
        deps: deps ? [...deps] : undefined,
      };

      return callback;
    }

    useEffectEvent<Callback extends (...args: never[]) => unknown>(callback: Callback) {
      const index = this.cursor;
      this.cursor += 1;

      const previous = this.hookValues[index] as { callback: Callback; event: Callback } | undefined;

      if (previous) {
        previous.callback = callback;
        return previous.event;
      }

      const state: { callback: Callback; event: Callback } = {
        callback,
        event: undefined as unknown as Callback,
      };
      state.event = ((...args: Parameters<Callback>) => state.callback(...args)) as Callback;
      this.hookValues[index] = state;

      return state.event;
    }

    useEffect(effect: () => Cleanup, deps?: unknown[]) {
      const index = this.cursor;
      this.cursor += 1;

      const previous = this.effectStates[index];
      const hasChanged =
        !previous ||
        !deps ||
        !previous.deps ||
        deps.length !== previous.deps.length ||
        deps.some((value, depIndex) => !Object.is(value, previous.deps?.[depIndex]));

      if (!hasChanged) {
        return;
      }

      this.pendingEffects.push(() => {
        if (typeof previous?.cleanup === 'function') {
          previous.cleanup();
        }

        this.effectStates[index] = {
          cleanup: effect(),
          deps: deps ? [...deps] : undefined,
        };
      });
    }

    useRef<Value>(initialValue: Value) {
      const index = this.cursor;
      this.cursor += 1;

      if (!(index in this.hookValues)) {
        this.hookValues[index] = { current: initialValue };
      }

      return this.hookValues[index] as { current: Value };
    }

    useState<Value>(initialValue: Value | (() => Value)) {
      const index = this.cursor;
      this.cursor += 1;

      if (!(index in this.hookValues)) {
        this.hookValues[index] =
          typeof initialValue === 'function' ? (initialValue as () => Value)() : initialValue;
      }

      const setState = (nextValue: Value | ((previousValue: Value) => Value)) => {
        const previousValue = this.hookValues[index] as Value;
        this.hookValues[index] =
          typeof nextValue === 'function'
            ? (nextValue as (previousValue: Value) => Value)(previousValue)
            : nextValue;
      };

      return [this.hookValues[index] as Value, setState] as const;
    }
  }

  return {
    HookRuntime,
    activeRuntimeRef,
    commitTelemetryMock: vi.fn(),
    configErrorRef: { current: false },
    configRef: { current: undefined as unknown },
    generateMock: vi.fn(),
    requestControlsRef: {
      current: null as unknown,
    },
    storeRef: {
      current: null as {
        dispatch: (action: unknown) => unknown;
        getState: () => unknown;
      } | null,
    },
    streamMock: vi.fn(),
  };
});

const USER_CANCELLED_NOTICE = 'Cancelled the in-progress generation at your request.';
const AUTOMATIC_REPAIR_RETRY_NOTICE = 'Something went wrong and your request was sent again';
const AUTOMATIC_REPAIR_RETRY_NOTICE_SECOND_ATTEMPT = 'Something went wrong and your request was sent again (2)';
const AUTOMATIC_REPAIR_TIMEOUT_MESSAGE = 'The automatic repair took too long.';
const AUTOMATIC_REPAIR_UPSTREAM_MESSAGE = 'The model service failed while repairing the draft.';
const GENERATION_FAILED_NOTICE =
  "Something went wrong and your request couldn’t be completed. The previous valid app was kept. Please retry.";

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');

  function getRuntime() {
    const runtime = testHarness.activeRuntimeRef.current;

    if (!runtime) {
      throw new Error('Hook called outside of the test hook runtime.');
    }

    return runtime;
  }

  return {
    ...actual,
    useCallback: <Callback extends (...args: never[]) => unknown>(callback: Callback, deps?: unknown[]) => {
      return getRuntime().useCallback(callback, deps);
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => getRuntime().useEffect(effect, deps),
    useEffectEvent: <Callback extends (...args: never[]) => unknown>(callback: Callback) => {
      return getRuntime().useEffectEvent(callback);
    },
    useRef: <Value>(initialValue: Value) => getRuntime().useRef(initialValue),
    useState: <Value>(initialValue: Value | (() => Value)) => getRuntime().useState(initialValue),
  };
});

vi.mock('@api/apiSlice', () => ({
  useConfigQuery: () => ({
    data: testHarness.configRef.current,
    isError: testHarness.configErrorRef.current,
  }),
}));

vi.mock('@store/store', () => ({
  store: {
    dispatch: (action: unknown) => {
      const store = testHarness.storeRef.current;

      if (!store) {
        throw new Error('Test store is not initialized.');
      }

      return store.dispatch(action);
    },
    getState: () => {
      const store = testHarness.storeRef.current;

      if (!store) {
        throw new Error('Test store is not initialized.');
      }

      return store.getState();
    },
  },
}));

vi.mock('@store/hooks', () => ({
  useAppDispatch: () => {
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    return store.dispatch;
  },
  useAppSelector: <Result>(selector: (state: unknown) => Result) => {
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    return selector(store.getState());
  },
}));

vi.mock('@store/resetAppState', () => ({
  resetAppStateWithDispatch: (dispatch: (action: { type: string }) => unknown) => {
    dispatch({ type: 'domain/resetDomainState' });
    dispatch({ type: 'builderSession/resetRuntimeSessionState' });
    dispatch({ type: 'builder/resetToEmpty' });
  },
}));

vi.mock('@pages/Chat/builder/api/generateDefinition', () => ({
  generateBuilderDefinition: (...args: Parameters<typeof testHarness.generateMock>) => testHarness.generateMock(...args),
}));

vi.mock('@pages/Chat/builder/api/streamGenerate', () => {
  class BuilderStreamTimeoutError extends Error {
    kind: string;

    constructor(kind: string) {
      super(`Timed out while waiting for the builder stream (${kind}).`);
      this.kind = kind;
      this.name = 'BuilderStreamTimeoutError';
    }
  }

  return {
    BuilderStreamTimeoutError,
    streamBuilderDefinition: (...args: Parameters<typeof testHarness.streamMock>) => testHarness.streamMock(...args),
  };
});

vi.mock('@pages/Chat/builder/api/commitTelemetry', () => ({
  postCommitTelemetry: (...args: Parameters<typeof testHarness.commitTelemetryMock>) => testHarness.commitTelemetryMock(...args),
}));

vi.mock('@pages/Chat/builder/context/builderRequestControls', () => ({
  useBuilderRequestControls: () => {
    const controls = testHarness.requestControlsRef.current;

    if (!controls) {
      throw new Error('Test request controls are not initialized.');
    }

    return controls;
  },
}));

import { builderActions, builderReducer } from '@pages/Chat/builder/store/builderSlice';
import { builderSessionActions, builderSessionReducer } from '@pages/Chat/builder/store/builderSessionSlice';
import { domainActions, domainReducer } from '@pages/Chat/builder/store/domainSlice';
import { BuilderStreamTimeoutError } from '@pages/Chat/builder/api/streamGenerate';
import { getBuilderComposerSubmitState } from '@pages/Chat/builder/hooks/submissionPrompt';
import { createBuilderSnapshot } from '@pages/Chat/builder/openui/runtime/persistedState';
import {
  RUNTIME_CONFIG_LOADING_NOTICE,
  RUNTIME_CONFIG_UNAVAILABLE_NOTICE,
} from '@pages/Chat/builder/components/chatNotices';
import { SYSTEM_CHAT_MESSAGE_KEYS } from '@pages/Chat/builder/store/chatMessageKeys';
import { useBuilderHistoryControls } from '@pages/Chat/builder/hooks/useBuilderHistoryControls';
import { useBuilderSubmission } from '@pages/Chat/builder/hooks/useBuilderSubmission';

const PREVIOUS_SOURCE = `root = AppShell([
  Screen("previous", "Previous", [
    Text("Previous app", "body", "start")
  ])
])`;

const VALID_STREAM_SOURCE = `root = AppShell([
  Screen("main", "Main", [
    Text("Hello", "body", "start")
  ])
])`;

const SHORT_PARTIAL_DRAFT = '{"source":"partial"}';
const LARGE_PARTIAL_DRAFT = 'x'.repeat(1024);

const SECOND_REQUEST_SOURCE = `root = AppShell([
  Screen("second", "Second", [
    Text("Second response", "body", "start")
  ])
])`;

const FIRST_REQUEST_LATE_SOURCE = `root = AppShell([
  Screen("late", "Late", [
    Text("Late response", "body", "start")
  ])
])`;

const PARSER_INVALID_SOURCE = 'root = AppShell([';

const QUALITY_BLOCKED_SOURCE = `root = AppShell([
  Screen("main", "Todo list", [
    Text("Selected priority: " + $lastChoice, "body", "start")
  ])
])`;

const FATAL_STRUCTURAL_SOURCE = `root = AppShell([
  Screen("main", "Main", [
    Group("Body", "vertical", [
      Screen("details", "Details", [
        Text("Nested", "body", "start")
      ])
    ])
  ])
])`;

const IQ_BUG_SOURCE = `root = AppShell([
  Screen("quiz", "IQ-like Test", [
    Group("Question 1", "vertical", [
      Text("What number comes next in the sequence: 2, 4, 8, 16, ?", "body", "start"),
      RadioGroup("q1", "Choose an answer", $q1, [
        { label: "18", value: "18" },
        { label: "24", value: "24" },
        { label: "32", value: "32" },
        { label: "36", value: "36" }
      ])
    ], "block"),
    Group("Question 2", "vertical", [
      Text("Which word does not belong: apple, banana, carrot, grape?", "body", "start"),
      RadioGroup("q2", "Choose an answer", $q2, [
        { label: "apple", value: "apple" },
        { label: "banana", value: "banana" },
        { label: "carrot", value: "carrot" },
        { label: "grape", value: "grape" }
      ])
    ], "block"),
    Group("Question 3", "vertical", [
      Text("If all Bloops are Razzies and all Razzies are Lazzies, are all Bloops Lazzies?", "body", "start"),
      RadioGroup("q3", "Choose an answer", $q3, [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
        { label: "Cannot be determined", value: "unknown" },
        { label: "Only sometimes", value: "sometimes" }
      ])
    ], "block"),
    Button("finish-test", "See score", "default", Action([@Set($currentScreen, "result")]), false)
  ], $currentScreen == "quiz"),
  Screen("result", "Result", [
    Group("Your answers", "vertical", [
      Text("Question 1: " + ($q1 == "32" ? "Correct" : "Wrong"), "body", "start"),
      Text("Question 2: " + ($q2 == "carrot" ? "Correct" : "Wrong"), "body", "start"),
      Text("Question 3: " + ($q3 == "yes" ? "Correct" : "Wrong"), "body", "start"),
      Text("Score: " + (($q1 == "32" ? 1 : 0) + ($q2 == "carrot" ? 1 : 0) + ($q3 == "yes" ? 1 : 0)) + "/3", "title", "start")
    ], "block"),
    Button("back-to-quiz", "Back", "secondary", Action([@Set($currentScreen, "quiz")]), false)
  ], $currentScreen == "result")
])`;

const REPAIRED_IQ_SOURCE = `$currentScreen = "quiz"
$q1 = ""
$q2 = ""
$q3 = ""

${IQ_BUG_SOURCE}`;

const NEW_BLOCKING_QUALITY_SOURCE = `items = Query("read_state", { path: "app.items" }, [])
toggleFirst = Mutation("merge_state", {
  path: "app.items.0",
  patch: { completed: true }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed)
], "inline"))

root = AppShell([
  Screen("main", "Items", [
    Repeater(rows, "No items yet.")
  ])
])`;

const CONTROL_ACTION_AND_BINDING_CHECKBOX_SOURCE = `$accepted = false

root = AppShell([
  Screen("main", "Main", [
    Checkbox("accepted", "Persist acceptance", $accepted, "Persists acceptance", [], Action([]))
  ])
])`;

const REPAIRED_CHECKBOX_SOURCE = `accepted = Query("read_state", { path: "prefs.accepted" }, false)
saveAccepted = Mutation("write_state", {
  path: "prefs.accepted",
  value: accepted ? false : true
})

root = AppShell([
  Screen("main", "Main", [
    Checkbox("accepted", "Persist acceptance", accepted, "Persists acceptance", [], Action([@Run(saveAccepted), @Run(accepted)]))
  ])
])`;

const CONTROL_ACTION_AND_BINDING_RADIO_SOURCE = `$plan = "pro"
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]

root = AppShell([
  Screen("main", "Main", [
    RadioGroup("plan", "Plan", $plan, planOptions, null, [], Action([]))
  ])
])`;

const REPAIRED_RADIO_SOURCE = `savedPlan = Query("read_state", { path: "prefs.plan" }, "pro")
savePlan = Mutation("write_state", {
  path: "prefs.plan",
  value: $lastChoice
})
planOptions = [
  { label: "Starter", value: "starter" },
  { label: "Pro", value: "pro" }
]

root = AppShell([
  Screen("main", "Main", [
    RadioGroup("plan", "Plan", savedPlan, planOptions, null, [], Action([@Run(savePlan), @Run(savedPlan)]))
  ])
])`;

const CONTROL_ACTION_AND_BINDING_SELECT_SOURCE = `$filter = "all"
filterOptions = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" }
]

root = AppShell([
  Screen("main", "Main", [
    Select("filter", "Filter", $filter, filterOptions, null, [], Action([]))
  ])
])`;

const REPAIRED_SELECT_SOURCE = `savedFilter = Query("read_state", { path: "prefs.filter" }, "all")
saveFilter = Mutation("write_state", {
  path: "prefs.filter",
  value: $lastChoice
})
filterOptions = [
  { label: "All", value: "all" },
  { label: "Completed", value: "completed" }
]

root = AppShell([
  Screen("main", "Main", [
    Select("filter", "Filter", savedFilter, filterOptions, null, [], Action([@Run(saveFilter), @Run(savedFilter)]))
  ])
])`;

const SMOKE_COMPLEX_LAST_CHOICE_SOURCE = `root = AppShell([
  Screen("tasks", "Task planner", [
    Group("Add task", "vertical", [
      Input("taskTitle", "Task title", $taskTitle, "Write a task", "Required", "text", [{ type: "required", message: "Task title is required" }, { type: "minLength", value: 3, message: "Use at least 3 characters" }]),
      Input("taskOwner", "Owner email", $taskOwner, "name@example.com", "Required", "email", [{ type: "required", message: "Owner email is required" }, { type: "email", message: "Enter a valid email address" }]),
      Select("taskPriority", "Priority", $taskPriority, priorityOptions, "Choose a priority", [{ type: "required", message: "Priority is required" }]),
      Group("Priority tools", "horizontal", [
        Button("random-priority", "Random priority", "secondary", Action([@Set($taskPriority, $lastChoice)]), false),
        Button("go-summary", "Go to summary", "default", Action([@Set($currentScreen, "summary")]), false)
      ], "inline")
    ], "block"),
    Group("Filters", "horizontal", [
      Select("statusFilter", "Show", $statusFilter, filterOptions, "Filter the task list", [{ type: "required", message: "Choose a filter" }]),
      Text("Visible tasks: " + visibleCount, "muted", "start")
    ], "inline"),
    Repeater(taskRows, "No tasks yet.")
  ], $currentScreen == "tasks", { mainColor: "#111827", contrastColor: "#F9FAFB" }),
  Screen("summary", "Summary", [
    Group("Overview", "vertical", [
      Text("Total tasks: " + taskCount, "body", "start"),
      Text("Completed tasks: " + completedCount, "body", "start"),
      Text("Random number: " + randomNumber, "body", "start"),
      Button("back-tasks", "Back to tasks", "secondary", Action([@Set($currentScreen, "tasks")]), false)
    ], "block")
  ], $currentScreen == "summary", { mainColor: "#111827", contrastColor: "#F9FAFB" })
], { mainColor: "#111827", contrastColor: "#F9FAFB" })

$currentScreen = "tasks"
$taskTitle = ""
$taskOwner = ""
$taskPriority = "medium"
$statusFilter = "all"
$targetItemId = ""

priorityOptions = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" }
]

filterOptions = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" }
]

tasks = Query("read_state", { path: "app.tasks" }, [
  { id: "t1", title: "Draft project brief", owner: "ada@example.com", priority: "high", completed: false },
  { id: "t2", title: "Review design mockups", owner: "sam@example.com", priority: "medium", completed: true },
  { id: "t3", title: "Prepare launch checklist", owner: "lee@example.com", priority: "low", completed: false }
])

randomNumber = Query("read_state", { path: "app.randomNumber" }, 0)

addTask = Mutation("append_item", {
  path: "app.tasks",
  value: { title: $taskTitle, owner: $taskOwner, priority: $taskPriority, completed: false }
})

toggleTask = Mutation("toggle_item_field", {
  path: "app.tasks",
  idField: "id",
  id: $targetItemId,
  field: "completed"
})

rollRandom = Mutation("write_computed_state", {
  path: "app.randomNumber",
  op: "random_int",
  options: { min: 1, max: 100 },
  returnType: "number"
})

visibleTasks = $statusFilter == "completed" ? @Filter(tasks, "completed", "==", true) : $statusFilter == "active" ? @Filter(tasks, "completed", "==", false) : tasks
visibleCount = @Count(visibleTasks)
taskCount = @Count(tasks)
completedCount = @Count(@Filter(tasks, "completed", "==", true))

taskRows = @Each(visibleTasks, "task", Group(null, "horizontal", [
  Checkbox("done-" + task.id, "", task.completed, null, null, Action([@Set($targetItemId, task.id), @Run(toggleTask), @Run(tasks)])),
  Text(task.title + " — " + task.owner + " — " + task.priority, "body", "start")
], "inline"))`;

const REPAIRED_SMOKE_COMPLEX_SOURCE = SMOKE_COMPLEX_LAST_CHOICE_SOURCE.replace(
  '        Button("random-priority", "Random priority", "secondary", Action([@Set($taskPriority, $lastChoice)]), false),',
  '        Button("random-number", "Random number", "secondary", Action([@Run(rollRandom), @Run(randomNumber)]), false),',
);

const AUTO_FIXABLE_SOURCE = `root = AppShell({ mainColor: "#FFFFFF", contrastColor: "#111827" }, [
  Screen("main", "Main", [
    Group("Filters", [
      Button("save", "Save", "default", Action([]), false, { textColor: "#FFFFFF", bgColor: "#111827" })
    ], "block")
  ]),
  Screen("settings", "Settings")
])`;

const AUTO_FIXED_SOURCE = `root = AppShell([
  Screen("main", "Main", [
    Group("Filters", "vertical", [
      Button("save", "Save", "default", Action([]), false, { contrastColor: "#FFFFFF", mainColor: "#111827" })
    ], "block")
  ]),
  Screen("settings", "Settings", [])
], { mainColor: "#FFFFFF", contrastColor: "#111827" })`;

const VALID_TODO_SOURCE = `$draft = ""
items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_state", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Text(item.completed ? "Done" : "Open", "muted", "end")
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No items yet.")
  ])
])`;

const IMPORTED_SOURCE = `root = AppShell([
  Screen("imported", "Imported", [
    Text("Imported app", "body", "start")
  ])
])`;

const UNDO_SOURCE = `root = AppShell([
  Screen("undo", "Undo target", [
    Text("Undo target", "body", "start")
  ])
])`;

const REDO_SOURCE = `root = AppShell([
  Screen("redo", "Redo target", [
    Text("Redo target", "body", "start")
  ])
])`;

const DEFAULT_CONFIG = {
  generation: {
    repairTemperature: 0.2,
    temperature: 0.4,
  },
  limits: {
    chatMessageMaxChars: 4_096,
    chatHistoryMaxItems: 40,
    promptMaxChars: 4_096,
    requestMaxBytes: 300_000,
    sourceMaxChars: 12_288,
  },
  repair: {
    maxRepairAttempts: 2,
    maxValidationIssues: 20,
  },
  timeouts: {
    streamIdleTimeoutMs: 45_000,
    streamMaxDurationMs: 120_000,
  },
};

function createAbortError() {
  return new DOMException('This operation was aborted', 'AbortError');
}

function createDeferred<Result>() {
  let resolvePromise!: (value: Result) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<Result>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

const controlActionAndBindingCases = [
  {
    controlName: 'Checkbox',
    prompt: 'Create a checkbox that saves persisted acceptance.',
    invalidSource: CONTROL_ACTION_AND_BINDING_CHECKBOX_SOURCE,
    repairedSource: REPAIRED_CHECKBOX_SOURCE,
  },
  {
    controlName: 'RadioGroup',
    prompt: 'Create a saved plan choice control.',
    invalidSource: CONTROL_ACTION_AND_BINDING_RADIO_SOURCE,
    repairedSource: REPAIRED_RADIO_SOURCE,
  },
  {
    controlName: 'Select',
    prompt: 'Create a saved filter control.',
    invalidSource: CONTROL_ACTION_AND_BINDING_SELECT_SOURCE,
    repairedSource: REPAIRED_SELECT_SOURCE,
  },
] as const;

function createFormEvent() {
  return {
    preventDefault: vi.fn(),
  } as unknown as FormEvent<HTMLFormElement>;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createTestStore() {
  return configureStore({
    reducer: {
      builder: builderReducer,
      builderSession: builderSessionReducer,
      domain: domainReducer,
    },
  });
}

function getBuilderState() {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  return (store.getState() as { builder: ReturnType<typeof builderReducer> }).builder;
}

function getBuilderSessionState() {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  return (store.getState() as { builderSession: { runtimeSessionState: Record<string, unknown> } }).builderSession.runtimeSessionState;
}

function getDomainState() {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  return (store.getState() as { domain: { data: Record<string, unknown> } }).domain.data;
}

function seedCommittedSource(source = PREVIOUS_SOURCE) {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  const snapshot = createBuilderSnapshot(source, {}, {});

  store.dispatch(
    builderActions.loadDefinition({
      appMemory: snapshot.appMemory,
      history: [snapshot],
      note: 'Seeded a committed source for the test.',
      runtimeState: snapshot.runtimeState,
      source,
    }),
  );
}

function seedHistorySnapshots(...snapshots: ReturnType<typeof createBuilderSnapshot>[]) {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  const latestSnapshot = snapshots.at(-1);

  if (!latestSnapshot) {
    throw new Error('Expected at least one history snapshot.');
  }

  store.dispatch(
    builderActions.loadDefinition({
      appMemory: latestSnapshot.appMemory,
      history: snapshots,
      note: 'Seeded builder history for the test.',
      runtimeState: latestSnapshot.runtimeState,
      source: latestSnapshot.source,
    }),
  );
  store.dispatch(domainActions.replaceData(latestSnapshot.domainData));
  store.dispatch(builderSessionActions.replaceRuntimeSessionState(latestSnapshot.runtimeState));
}

function seedHistorySources(...sources: string[]) {
  const snapshots = sources.map((source) => createBuilderSnapshot(source, {}, {}));
  seedHistorySnapshots(...snapshots);

  return snapshots;
}

function setDraftPrompt(prompt: string) {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  store.dispatch(builderActions.setDraftPrompt(prompt));
}

function appendChatMessages(
  messages: Array<{ content: string; role: 'assistant' | 'system' | 'user'; excludeFromLlmContext?: boolean }>,
) {
  const store = testHarness.storeRef.current;

  if (!store) {
    throw new Error('Test store is not initialized.');
  }

  for (const message of messages) {
    store.dispatch(
      builderActions.appendChatMessage({
        content: message.content,
        role: message.role,
        excludeFromLlmContext: message.excludeFromLlmContext,
      }),
    );
  }
}

function createTestRequestControls() {
  let abortController: AbortController | null = null;
  let cancelActiveRequestHandler: (() => void) | null = null;

  const controls = {
    abortActiveTransport: () => {
      const controller = abortController;
      abortController = null;
      controller?.abort();
    },
    cancelActiveRequest: () => {
      cancelActiveRequestHandler?.();
    },
    clearAbortController: (controller?: AbortController) => {
      if (!controller || abortController === controller) {
        abortController = null;
      }
    },
    createAbortController: () => {
      abortController = new AbortController();
      return abortController;
    },
    getAbortSignal: () => abortController?.signal,
    registerCancelActiveRequest: (handler: (() => void) | null) => {
      cancelActiveRequestHandler = handler;

      return () => {
        if (cancelActiveRequestHandler === handler) {
          cancelActiveRequestHandler = null;
        }
      };
    },
  };

  return {
    controls,
    get abortController() {
      return abortController;
    },
    get cancelActiveRequestHandler() {
      return cancelActiveRequestHandler;
    },
  };
}

type TestRequestControls = ReturnType<typeof createTestRequestControls>;

let currentRequestControls: TestRequestControls | null = null;

function setCurrentRequestControls(requestControls: TestRequestControls) {
  currentRequestControls = requestControls;
  testHarness.requestControlsRef.current = requestControls.controls;
  return requestControls;
}

function getCurrentRequestControls() {
  if (currentRequestControls) {
    return currentRequestControls;
  }

  return setCurrentRequestControls(createTestRequestControls());
}

function createSubmissionHarness() {
  const requestControls = setCurrentRequestControls(createTestRequestControls());
  const onSystemNotice = vi.fn();
  const runtime = new testHarness.HookRuntime();
  const options = {
    onSystemNotice,
  };
  let result = runtime.render(() => useBuilderSubmission(options));

  return {
    onSystemNotice,
    requestControls,
    rerender() {
      result = runtime.render(() => useBuilderSubmission(options));
      return result;
    },
    result() {
      return result;
    },
    unmount() {
      runtime.unmount();
    },
  };
}

function createHistoryControlsHarness(requestControls = getCurrentRequestControls()) {
  setCurrentRequestControls(requestControls);
  const onSystemNotice = vi.fn();
  const runtime = new testHarness.HookRuntime();
  const options = {
    onSystemNotice,
  };
  let result = runtime.render(() => useBuilderHistoryControls(options));

  return {
    onSystemNotice,
    requestControls,
    rerender() {
      result = runtime.render(() => useBuilderHistoryControls(options));
      return result;
    },
    result() {
      return result;
    },
    unmount() {
      runtime.unmount();
    },
  };
}

function createImportEvent(file: { name: string; text: () => Promise<string> }) {
  return {
    target: {
      files: [file],
      value: 'import.json',
    },
  } as unknown as ChangeEvent<HTMLInputElement>;
}

function createImportPayload(
  source = IMPORTED_SOURCE,
  overrides: Partial<{
    domainData: Record<string, unknown>;
    history: ReturnType<typeof createBuilderSnapshot>[];
    runtimeState: Record<string, unknown>;
  }> = {},
) {
  return JSON.stringify({
    domainData: {},
    history: [],
    runtimeState: {},
    source,
    version: 1,
    ...overrides,
  });
}

function findChatMessage(content: string) {
  return getBuilderState().chatMessages.find((message) => message.content === content);
}

function findChatMessages(content: string) {
  return getBuilderState().chatMessages.filter((message) => message.content === content);
}

function getCancelStreamingActions(dispatchSpy: { mock: { calls: Array<[unknown, ...unknown[]]> } }) {
  return dispatchSpy.mock.calls.map(([action]) => action).filter(builderActions.cancelStreaming.match);
}

function findRepairStatusMessages() {
  return getBuilderState().chatMessages.filter(
    (message) =>
      message.content.includes('The model returned a draft that cannot be committed yet.') ||
      message.content.includes('Repairing draft automatically') ||
      message.content.includes(AUTOMATIC_REPAIR_RETRY_NOTICE),
  );
}

function getComposerSubmitState(submission: ReturnType<typeof createSubmissionHarness>) {
  const result = submission.rerender();

  return getBuilderComposerSubmitState({
    configStatus: result.configStatus,
    draftPrompt: result.draftPrompt,
    hasCommittedSource: getBuilderState().committedSource.trim().length > 0,
    isSubmitting: result.isSubmitting,
    retryPrompt: result.retryPrompt,
  });
}

beforeEach(() => {
  testHarness.commitTelemetryMock.mockReset();
  testHarness.configErrorRef.current = false;
  testHarness.storeRef.current = createTestStore();
  testHarness.configRef.current = DEFAULT_CONFIG;
  testHarness.streamMock.mockReset();
  testHarness.generateMock.mockReset();
  testHarness.requestControlsRef.current = null;
  currentRequestControls = null;
});

describe('useBuilderSubmission', () => {
  it('commits a valid streamed source without repair', async () => {
    setDraftPrompt('Add a welcome screen.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());
    const initialRequestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(testHarness.commitTelemetryMock).toHaveBeenCalledWith({
      commitSource: 'streaming',
      committed: true,
      qualityWarnings: [],
      requestId: initialRequestId,
      validationIssues: [],
    });
    expect(getBuilderState().committedSource).toBe(VALID_STREAM_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().history).toHaveLength(2);
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Applied the latest chat instruction to the app definition.',
        role: 'assistant',
        tone: 'success',
      }),
    );

    submission.unmount();
  });

  it('reports soft quality warnings on successful commit telemetry', async () => {
    setDraftPrompt('Add a welcome screen.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
      qualityIssues: [
        {
          code: 'quality-unrequested-theme',
          message: 'Theme styling was added even though not requested.',
          severity: 'soft-warning',
          source: 'quality',
        },
      ],
    });

    await submission.result().handleSubmit(createFormEvent());
    const initialRequestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;

    expect(testHarness.commitTelemetryMock).toHaveBeenCalledWith({
      commitSource: 'streaming',
      committed: true,
      qualityWarnings: ['quality-unrequested-theme'],
      requestId: initialRequestId,
      validationIssues: [],
    });

    submission.unmount();
  });

  it('shows a partial streamed summary before commit, finalizes it on success, and removes it on failure', async () => {
    setDraftPrompt('Add a welcome screen.');
    const submission = createSubmissionHarness();
    const streamResult = createDeferred<{ source: string; summary: string }>();

    testHarness.streamMock.mockImplementationOnce(
      async ({ onSummary }: { onSummary?: (summary: string) => void }) => {
        onSummary?.('Adds a welcome');
        return streamResult.promise;
      },
    );

    const requestPromise = submission.result().handleSubmit(createFormEvent());
    await flushMicrotasks();

    expect(findChatMessage('Adds a welcome')).toEqual(
      expect.objectContaining({
        content: 'Adds a welcome',
        excludeFromLlmContext: true,
        isStreaming: true,
        role: 'assistant',
      }),
    );

    streamResult.resolve({
      source: VALID_STREAM_SOURCE,
      summary: 'Adds a welcome screen',
    });
    await requestPromise;

    expect(findChatMessage('Adds a welcome')).toBeUndefined();
    expect(findChatMessage('Adds a welcome screen')).toEqual(
      expect.objectContaining({
        content: 'Adds a welcome screen',
        excludeFromLlmContext: undefined,
        isStreaming: undefined,
        role: 'assistant',
      }),
    );
    expect(getBuilderState().chatMessages.some((message) => message.content === 'Applied the latest chat instruction to the app definition.')).toBe(
      false,
    );

    setDraftPrompt('Create a settings app.');

    testHarness.streamMock.mockImplementationOnce(
      async ({ onChunk, onSummary }: { onChunk: (chunk: string) => void; onSummary?: (summary: string) => void }) => {
        onSummary?.('Creates a settings app');
        onChunk(LARGE_PARTIAL_DRAFT);
        throw new Error('The model stream ended before it returned any OpenUI source.');
      },
    );

    await submission.rerender().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(findChatMessage('Creates a settings app')).toBeUndefined();
    expect(findChatMessage('Adds a welcome screen')).toEqual(
      expect.objectContaining({
        content: 'Adds a welcome screen',
        role: 'assistant',
      }),
    );
    expect(getBuilderState().streamError).toBe('The model stopped before it returned a usable draft. Please try again.');

    submission.unmount();
  });

  it('keeps low-signal committed summaries out of future LLM context when the backend marks them as technical', async () => {
    setDraftPrompt('Do a tiny update.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
      summary: 'Updated the app.',
      summaryExcludeFromLlmContext: true,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(findChatMessage('Updated the app.')).toEqual(
      expect.objectContaining({
        content: 'Updated the app.',
        excludeFromLlmContext: true,
        role: 'assistant',
      }),
    );
    expect(getBuilderState().chatMessages.some((message) => message.content === 'Applied the latest chat instruction to the app definition.')).toBe(
      false,
    );

    submission.unmount();
  });

  it('throttles repeated pending summary updates but still commits the latest summary', async () => {
    vi.useFakeTimers();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    try {
      const streamResult = createDeferred<{ source: string; summary: string }>();

      testHarness.streamMock.mockImplementationOnce(
        async ({ onSummary }: { onSummary?: (summary: string) => void }) => {
          onSummary?.('Creates');
          onSummary?.('Creates a settings');
          onSummary?.('Creates a settings app');
          return streamResult.promise;
        },
      );

      const requestPromise = submission.result().handleSubmit(createFormEvent());
      await flushMicrotasks();

      expect(findChatMessage('Creates')).toEqual(
        expect.objectContaining({
          content: 'Creates',
          isStreaming: true,
          role: 'assistant',
        }),
      );
      expect(findChatMessage('Creates a settings app')).toBeUndefined();

      await vi.advanceTimersByTimeAsync(149);

      expect(findChatMessage('Creates a settings app')).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);

      expect(findChatMessage('Creates')).toBeUndefined();
      expect(findChatMessage('Creates a settings app')).toEqual(
        expect.objectContaining({
          content: 'Creates a settings app',
          isStreaming: true,
          role: 'assistant',
        }),
      );

      streamResult.resolve({
        source: VALID_STREAM_SOURCE,
        summary: 'Creates a settings app',
      });
      await requestPromise;

      expect(findChatMessage('Creates a settings app')).toEqual(
        expect.objectContaining({
          content: 'Creates a settings app',
          isStreaming: undefined,
          role: 'assistant',
        }),
      );
    } finally {
      submission.unmount();
      vi.useRealTimers();
    }
  });

  it('blocks an oversized request before sending it to the backend', async () => {
    seedCommittedSource('x'.repeat(512));
    setDraftPrompt('Build a small app.');
    testHarness.configRef.current = {
      ...DEFAULT_CONFIG,
      limits: {
        ...DEFAULT_CONFIG.limits,
        requestMaxBytes: 128,
      },
    };
    const submission = createSubmissionHarness();

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.streamMock).not.toHaveBeenCalled();
    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(submission.onSystemNotice).toHaveBeenCalledWith({
      content:
        'The request is too large to send as-is. Limit: 128 bytes for the full request payload. Shorten the prompt or reduce recent context and try again.',
      tone: 'error',
    });
    expect(getBuilderState().currentRequestId).toBeNull();
    expect(getBuilderState().committedSource).toBe('x'.repeat(512));

    submission.unmount();
  });

  it('sends backend-compatible chat history to the backend after prefiltering', async () => {
    appendChatMessages(
      Array.from({ length: 60 }, (_, index) => ({
        content: `Context message ${index}`,
        role: index % 2 === 0 ? 'assistant' : 'system',
        excludeFromLlmContext: index === 0 ? true : undefined,
      })),
    );
    setDraftPrompt('Add a welcome screen.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    const request = (testHarness.streamMock.mock.calls[0]?.[0] as {
      request: { chatHistory: Array<{ content: string; role: string }> };
    }).request;

    expect(request.chatHistory).toHaveLength(29);
    expect(request.chatHistory[0]?.content).toBe('Context message 2');
    expect(request.chatHistory.at(-1)?.content).toBe('Context message 58');
    expect(request.chatHistory.every((message) => message.role === 'assistant')).toBe(true);

    submission.unmount();
  });

  it('does not send stale chat history after a successful import', async () => {
    appendChatMessages([
      { content: 'Build a stale CRM app.', role: 'user' },
      { content: 'Built the stale CRM app.', role: 'assistant' },
    ]);
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.requestControls);

    await historyControls.result().handleImport(
      createImportEvent({
        name: 'import.json',
        text: async () => createImportPayload(),
      }),
    );

    setDraftPrompt('Add filtering.');
    submission.rerender();
    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    const request = (testHarness.streamMock.mock.calls[0]?.[0] as {
      request: { chatHistory: Array<{ content: string; role: string }> };
    }).request;

    expect(request.chatHistory).toEqual([]);

    historyControls.unmount();
    submission.unmount();
  });

  it('resets the builder before reading a valid import and then loads the imported app', async () => {
    const staleSnapshot = createBuilderSnapshot(PREVIOUS_SOURCE, { $draft: 'stale' }, { app: { stale: true } });

    seedHistorySnapshots(staleSnapshot);
    appendChatMessages([
      { content: 'Build a stale app.', role: 'user' },
      { content: 'Built the stale app.', role: 'assistant' },
    ]);
    const historyControls = createHistoryControlsHarness();
    const importedRuntimeState = { $screen: 'imported' };
    const importedDomainData = { app: { imported: true } };

    await historyControls.result().handleImport(
      createImportEvent({
        name: 'import.json',
        text: async () => {
          expect(getBuilderState().committedSource).toBe('');
          expect(getBuilderState().streamedSource).toBe('');
          expect(getBuilderState().history).toHaveLength(1);
          expect(getBuilderSessionState()).toEqual({});
          expect(getDomainState()).toEqual({});

          return createImportPayload(IMPORTED_SOURCE, {
            domainData: importedDomainData,
            runtimeState: importedRuntimeState,
          });
        },
      }),
    );

    expect(getBuilderState().committedSource).toBe(IMPORTED_SOURCE);
    expect(getBuilderSessionState()).toEqual(importedRuntimeState);
    expect(getDomainState()).toEqual(importedDomainData);
    expect(getBuilderState().chatMessages.some((message) => message.content === 'Build a stale app.')).toBe(false);

    historyControls.unmount();
  });

  it('resets stale app state when an import file is not valid JSON', async () => {
    const staleSnapshot = createBuilderSnapshot(PREVIOUS_SOURCE, { $draft: 'stale' }, { app: { stale: true } });

    seedHistorySnapshots(staleSnapshot);
    const historyControls = createHistoryControlsHarness();

    await historyControls.result().handleImport(
      createImportEvent({
        name: 'broken.json',
        text: async () => '{"data"',
      }),
    );

    expect(getBuilderState().committedSource).toBe('');
    expect(getBuilderState().streamedSource).toBe('');
    expect(getBuilderSessionState()).toEqual({});
    expect(getDomainState()).toEqual({});
    expect(findChatMessage('Import failed: Import file is not valid JSON.')).toEqual(
      expect.objectContaining({
        role: 'system',
        tone: 'error',
      }),
    );

    historyControls.unmount();
  });

  it('resets stale app state when an import contains invalid OpenUI source', async () => {
    const invalidImportedSource = 'root = UnknownComponent([])';
    const staleSnapshot = createBuilderSnapshot(PREVIOUS_SOURCE, { $draft: 'stale' }, { app: { stale: true } });

    seedHistorySnapshots(staleSnapshot);
    const historyControls = createHistoryControlsHarness();

    await historyControls.result().handleImport(
      createImportEvent({
        name: 'invalid.json',
        text: async () => createImportPayload(invalidImportedSource),
      }),
    );

    expect(getBuilderState().committedSource).toBe('');
    expect(getBuilderState().streamedSource).toBe(invalidImportedSource);
    expect(getBuilderState().hasRejectedDefinition).toBe(true);
    expect(getBuilderState().parseIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unknown-component',
          statementId: 'root',
        }),
      ]),
    );
    expect(getBuilderSessionState()).toEqual({});
    expect(getDomainState()).toEqual({});
    expect(findChatMessage('Import failed: the OpenUI definition is invalid. Review the Definition tab for validation issues.')).toEqual(
      expect.objectContaining({
        role: 'system',
        tone: 'error',
      }),
    );

    historyControls.unmount();
  });

  it('does not send stale chat history after loading a demo definition', async () => {
    appendChatMessages([
      { content: 'Build a stale CRM app.', role: 'user' },
      { content: 'Built the stale CRM app.', role: 'assistant' },
    ]);
    const demoSnapshot = createBuilderSnapshot(VALID_TODO_SOURCE, {}, { app: { items: [] as string[] } });

    testHarness.storeRef.current?.dispatch(domainActions.replaceData(demoSnapshot.domainData));
    testHarness.storeRef.current?.dispatch(builderSessionActions.replaceRuntimeSessionState(demoSnapshot.runtimeState));
    testHarness.storeRef.current?.dispatch(
      builderActions.applyDemoDefinition({
        label: 'Todo demo',
        snapshot: demoSnapshot,
      }),
    );
    setDraftPrompt('Add sorting.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    const request = (testHarness.streamMock.mock.calls[0]?.[0] as {
      request: { chatHistory: Array<{ content: string; role: string }> };
    }).request;

    expect(request.chatHistory).toEqual([]);

    submission.unmount();
  });

  it('does not send stale chat history after resetting the builder to empty', async () => {
    appendChatMessages([
      { content: 'Build a stale CRM app.', role: 'user' },
      { content: 'Built the stale CRM app.', role: 'assistant' },
    ]);

    testHarness.storeRef.current?.dispatch(builderActions.resetToEmpty());
    setDraftPrompt('Create a new small app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    const request = (testHarness.streamMock.mock.calls[0]?.[0] as {
      request: { chatHistory: Array<{ content: string; role: string }> };
    }).request;

    expect(request.chatHistory).toEqual([]);

    submission.unmount();
  });

  it('sends previousSource only when there is a prior committed history snapshot', async () => {
    seedHistorySources(PREVIOUS_SOURCE, SECOND_REQUEST_SOURCE);
    setDraftPrompt('Add sorting.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    const request = (testHarness.streamMock.mock.calls[0]?.[0] as {
      request: { currentSource: string; previousSource?: string };
    }).request;

    expect(request.currentSource).toBe(SECOND_REQUEST_SOURCE);
    expect(request).toHaveProperty('previousSource', PREVIOUS_SOURCE);

    submission.unmount();
  });

  it('does not send previousSource for the initial committed snapshot', async () => {
    seedCommittedSource(PREVIOUS_SOURCE);
    setDraftPrompt('Add sorting.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    const request = (testHarness.streamMock.mock.calls[0]?.[0] as {
      request: { previousSource?: string };
    }).request;

    expect(Object.prototype.hasOwnProperty.call(request, 'previousSource')).toBe(false);

    submission.unmount();
  });

  it('keeps the failed prompt in chat history when Repeat resubmits it', async () => {
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock
      .mockImplementationOnce(async ({ onChunk }: { onChunk: (chunk: string) => void }) => {
        onChunk(SHORT_PARTIAL_DRAFT);
        throw new Error('The stream failed after it started.');
      })
      .mockResolvedValueOnce({
        source: VALID_STREAM_SOURCE,
      });

    await submission.result().handleSubmit(createFormEvent());

    expect(getBuilderState().retryPrompt).toBe('Create a settings app.');

    await submission.rerender().handleSubmit(createFormEvent());

    const repeatRequest = (testHarness.streamMock.mock.calls[1]?.[0] as {
      request: { chatHistory: Array<{ content: string; role: string }>; prompt: string };
    }).request;

    expect(repeatRequest.prompt).toBe('Create a settings app.');
    expect(repeatRequest.chatHistory).toEqual([
      {
        content: 'Create a settings app.',
        role: 'user',
      },
    ]);

    submission.unmount();
  });

  it('keeps chat send unavailable until the first runtime config load completes', async () => {
    setDraftPrompt('Build a small app.');
    testHarness.configRef.current = undefined;
    const submission = createSubmissionHarness();

    expect(getComposerSubmitState(submission)).toEqual({
      disabled: true,
      label: 'Loading config...',
      mode: 'config-loading',
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.streamMock).not.toHaveBeenCalled();
    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(submission.onSystemNotice).toHaveBeenCalledWith({
      content: RUNTIME_CONFIG_LOADING_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.runtimeConfigStatus,
      tone: 'info',
    });

    submission.unmount();
  });

  it('keeps chat send unavailable when the runtime config request fails', async () => {
    setDraftPrompt('Build a small app.');
    testHarness.configErrorRef.current = true;
    testHarness.configRef.current = undefined;
    const submission = createSubmissionHarness();

    expect(getComposerSubmitState(submission)).toEqual({
      disabled: true,
      label: 'Send unavailable',
      mode: 'config-unavailable',
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.streamMock).not.toHaveBeenCalled();
    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(submission.onSystemNotice).toHaveBeenCalledWith({
      content: RUNTIME_CONFIG_UNAVAILABLE_NOTICE,
      messageKey: SYSTEM_CHAT_MESSAGE_KEYS.runtimeConfigStatus,
      tone: 'error',
    });

    submission.unmount();
  });

  it('repairs an invalid streamed draft and commits the repaired source', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: PARSER_INVALID_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: VALID_TODO_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect(getBuilderState().committedSource).toBe(VALID_TODO_SOURCE);
    expect(findRepairStatusMessages()).toEqual([]);
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'The first draft had parser issues, so it was repaired automatically before commit.',
        role: 'assistant',
        tone: 'success',
      }),
    );

    submission.unmount();
  });

  it('updates the pending streamed summary with the automatic retry status while waiting for repair', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();
    const repairResult = createDeferred<{ source: string; summary: string }>();

    testHarness.streamMock.mockImplementationOnce(async ({ onSummary }: { onSummary?: (summary: string) => void }) => {
      onSummary?.('Builds a todo list');

      return {
        source: PARSER_INVALID_SOURCE,
      };
    });
    testHarness.generateMock.mockImplementationOnce(() => repairResult.promise);

    const requestPromise = submission.result().handleSubmit(createFormEvent());
    await flushMicrotasks();

    const repairStatus = findChatMessage(AUTOMATIC_REPAIR_RETRY_NOTICE);

    expect(findRepairStatusMessages()).toEqual([
      expect.objectContaining({
        content: AUTOMATIC_REPAIR_RETRY_NOTICE,
        excludeFromLlmContext: true,
        isStreaming: true,
        role: 'assistant',
      }),
    ]);
    expect(repairStatus?.id).toBeDefined();

    repairResult.resolve({
      summary: 'Builds a repaired todo list',
      source: VALID_TODO_SOURCE,
    });
    await requestPromise;

    expect(findRepairStatusMessages()).toEqual([]);
    expect(findChatMessage('Builds a repaired todo list')?.id).toBe(repairStatus?.id);
    expect(getBuilderState().committedSource).toBe(VALID_TODO_SOURCE);

    submission.unmount();
  });

  it('edits the same pending summary when a second automatic repair starts', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();
    const secondRepairResult = createDeferred<{ source: string; summary: string }>();

    testHarness.streamMock.mockImplementationOnce(async ({ onSummary }: { onSummary?: (summary: string) => void }) => {
      onSummary?.('Builds a todo list');

      return {
        source: PARSER_INVALID_SOURCE,
      };
    });
    testHarness.generateMock
      .mockResolvedValueOnce({
        source: PARSER_INVALID_SOURCE,
      })
      .mockImplementationOnce(() => secondRepairResult.promise);

    const requestPromise = submission.result().handleSubmit(createFormEvent());
    await flushMicrotasks();
    await flushMicrotasks();

    const secondRetryStatus = findChatMessage(AUTOMATIC_REPAIR_RETRY_NOTICE_SECOND_ATTEMPT);

    expect(testHarness.generateMock).toHaveBeenCalledTimes(2);
    expect(findChatMessage(AUTOMATIC_REPAIR_RETRY_NOTICE)).toBeUndefined();
    expect(secondRetryStatus).toEqual(
      expect.objectContaining({
        content: AUTOMATIC_REPAIR_RETRY_NOTICE_SECOND_ATTEMPT,
        isStreaming: true,
        role: 'assistant',
      }),
    );

    secondRepairResult.resolve({
      summary: 'Builds a repaired todo list',
      source: VALID_TODO_SOURCE,
    });
    await requestPromise;

    expect(findChatMessage('Builds a repaired todo list')?.id).toBe(secondRetryStatus?.id);
    expect(getBuilderState().committedSource).toBe(VALID_TODO_SOURCE);

    submission.unmount();
  });

  it('surfaces a repair-specific timeout message when the automatic repair request times out', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: PARSER_INVALID_SOURCE,
    });
    testHarness.generateMock.mockRejectedValue({
      code: 'timeout_error',
      message: 'The model request timed out.',
      status: 504,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a todo list.');
    expect(getBuilderState().streamError).toContain(AUTOMATIC_REPAIR_TIMEOUT_MESSAGE);
    expect(getBuilderState().streamError).toContain('Code: timeout_error');
    expect(getBuilderState().streamError).toContain('Status: 504');
    expect(getBuilderState().streamError).toContain('Message: The model request timed out.');
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: GENERATION_FAILED_NOTICE,
        role: 'system',
        technicalDetails: expect.not.stringContaining('The previous valid app was kept'),
        tone: 'error',
      }),
    );
    expect(findRepairStatusMessages()).toEqual([]);

    submission.unmount();
  });

  it('keeps retry guidance in the failure notice instead of upstream repair details', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: PARSER_INVALID_SOURCE,
    });
    testHarness.generateMock.mockRejectedValue({
      code: 'upstream_error',
      message: 'Provider returned 502.',
      status: 502,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: GENERATION_FAILED_NOTICE,
        role: 'system',
        technicalDetails: expect.stringContaining(AUTOMATIC_REPAIR_UPSTREAM_MESSAGE),
        tone: 'error',
      }),
    );
    expect(getBuilderState().streamError).toContain('Code: upstream_error');
    expect(getBuilderState().streamError).toContain('Status: 502');
    expect(getBuilderState().streamError).toContain('Message: Provider returned 502.');
    expect(getBuilderState().streamError).not.toContain('The previous valid app was kept');
    expect(getBuilderState().streamError).not.toContain('Please retry');

    submission.unmount();
  });

  it('reports failed repair outcome when a quality repair request fails', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: QUALITY_BLOCKED_SOURCE,
    });
    testHarness.generateMock.mockRejectedValue({
      code: 'timeout_error',
      message: 'The model request timed out.',
      status: 504,
    });

    await submission.result().handleSubmit(createFormEvent());

    const initialRequestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(1, {
      commitSource: 'streaming',
      committed: false,
      requestId: initialRequestId,
      validationIssues: ['reserved-last-choice-outside-action-mode'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(2, {
      commitSource: 'streaming',
      committed: false,
      repairOutcome: 'failed',
      requestId: initialRequestId,
      validationIssues: ['reserved-last-choice-outside-action-mode'],
    });
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toContain(AUTOMATIC_REPAIR_TIMEOUT_MESSAGE);
    expect(getBuilderState().streamError).toContain('Code: timeout_error');
    expect(getBuilderState().streamError).toContain('Status: 504');

    submission.unmount();
  });

  it('fails immediately for fatal structural drafts without sending a repair request', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a small app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: FATAL_STRUCTURAL_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a small app.');
    expect(getBuilderState().streamError).toContain('without an automatic repair attempt');
    expect(getBuilderState().streamError).toContain('screen-inside-screen');
    expect(findRepairStatusMessages()).toEqual([]);

    submission.unmount();
  });

  it('repairs a parser-invalid draft through the backend repair path before commit', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: AUTO_FIXABLE_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: AUTO_FIXED_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.streamMock).toHaveBeenCalledTimes(1);
    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect(getBuilderState().committedSource).toBe(AUTO_FIXED_SOURCE);
    submission.unmount();
  });

  it('keeps the previous source after two parser repairs stay invalid', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: PARSER_INVALID_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: PARSER_INVALID_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).toHaveBeenCalledTimes(2);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a todo list.');
    expect(getBuilderState().streamError).toContain('after 2 automatic repair attempts');
    expect(getBuilderState().streamError).toContain('incomplete-source');
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: GENERATION_FAILED_NOTICE,
        role: 'system',
        technicalDetails: expect.stringContaining('after 2 automatic repair attempts'),
        tone: 'error',
      }),
    );

    submission.unmount();
  });

  it('repairs a parser-valid blocking-quality draft once and commits the repaired source', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: QUALITY_BLOCKED_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: VALID_TODO_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());
    const initialRequestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;
    const repairRequestId = (testHarness.generateMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect((testHarness.generateMock.mock.calls[0]?.[0] as { request: { mode?: string } }).request.mode).toBe('repair');
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(1, {
      commitSource: 'streaming',
      committed: false,
      requestId: initialRequestId,
      validationIssues: ['reserved-last-choice-outside-action-mode'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(2, {
      commitSource: 'streaming',
      committed: false,
      repairOutcome: 'fixed',
      requestId: initialRequestId,
      validationIssues: ['reserved-last-choice-outside-action-mode'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(3, {
      commitSource: 'fallback',
      committed: true,
      qualityWarnings: [],
      requestId: repairRequestId,
      validationIssues: [],
    });
    expect(getBuilderState().committedSource).toBe(VALID_TODO_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(findRepairStatusMessages()).toEqual([]);
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'The first draft had blocking quality issues, so it was repaired automatically before commit.',
        role: 'assistant',
        tone: 'success',
      }),
    );

    submission.unmount();
  });

  it('repairs a draft with missing top-level state declarations once and commits the repaired source', async () => {
    seedCommittedSource();
    setDraftPrompt('Create an IQ-like test with a quiz screen and a result screen.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: IQ_BUG_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: REPAIRED_IQ_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());
    const initialRequestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);

    const repairCall = testHarness.generateMock.mock.calls[0]?.[0] as {
      request: {
        invalidDraft?: string;
        mode?: string;
        parentRequestId?: string;
        prompt: string;
        repairAttemptNumber?: number;
        validationIssues?: Array<{ code: string }>;
      };
      requestId?: string;
      requestKind?: string;
    };
    const repairRequest = repairCall.request;

    expect(repairCall.requestId).not.toBe(initialRequestId);
    expect(repairCall.requestKind).toBe('automatic-repair');
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(1, {
      commitSource: 'streaming',
      committed: false,
      requestId: initialRequestId,
      validationIssues: ['undefined-state-reference'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(2, {
      commitSource: 'streaming',
      committed: false,
      repairOutcome: 'fixed',
      requestId: initialRequestId,
      validationIssues: ['undefined-state-reference'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(3, {
      commitSource: 'fallback',
      committed: true,
      qualityWarnings: [],
      requestId: repairCall.requestId,
      validationIssues: [],
    });

    expect(repairRequest.mode).toBe('repair');
    expect(repairRequest.parentRequestId).toBe(initialRequestId);
    expect(repairRequest.repairAttemptNumber).toBe(1);
    expect(repairRequest.prompt).toBe('Create an IQ-like test with a quiz screen and a result screen.');
    expect(repairRequest.invalidDraft).toBe(IQ_BUG_SOURCE);
    expect(repairRequest.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'undefined-state-reference',
          context: {
            exampleInitializer: '"32"',
            refName: '$q1',
          },
        }),
      ]),
    );
    expect(getBuilderState().committedSource).toBe(REPAIRED_IQ_SOURCE);
    expect(getBuilderState().streamError).toBeNull();

    submission.unmount();
  });

  it('includes new blocking-quality issue codes in the repair request payload', async () => {
    seedCommittedSource();
    setDraftPrompt('Create an item browser with row actions.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: NEW_BLOCKING_QUALITY_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    const initialRequestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;

    const repairRequest = (testHarness.generateMock.mock.calls[0]?.[0] as {
      request: {
        chatHistory?: Array<{ content: string; role: string }>;
        invalidDraft?: string;
        mode?: string;
        parentRequestId?: string;
        prompt: string;
        validationIssues?: Array<{ code: string }>;
      };
    }).request;

    expect(repairRequest.mode).toBe('repair');
    expect(repairRequest.parentRequestId).toBe(initialRequestId);
    expect(repairRequest.prompt).toBe('Create an item browser with row actions.');
    expect(repairRequest.invalidDraft).toBe(NEW_BLOCKING_QUALITY_SOURCE);
    expect(repairRequest.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'item-bound-control-without-action' }),
        expect.objectContaining({ code: 'mutation-uses-array-index-path' }),
      ]),
    );
    const repairNotice = repairRequest.chatHistory?.at(-1);

    expect(repairNotice?.role).toBe('assistant');
    expect(repairNotice?.content).toContain('Previous draft rejected due to:');
    expect(repairNotice?.content).toContain('`item-bound-control-without-action`');
    expect(repairNotice?.content).toContain('`mutation-uses-array-index-path`');
    expect(getBuilderState().committedSource).toBe(VALID_STREAM_SOURCE);

    submission.unmount();
  });

  it('keeps the previous source after two quality repairs are still blocked', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a todo list.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: QUALITY_BLOCKED_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: QUALITY_BLOCKED_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());
    const initialRequestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;
    const firstRepairRequestId = (testHarness.generateMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;
    const secondRepairRequestId = (testHarness.generateMock.mock.calls[1]?.[0] as { requestId?: string }).requestId;

    expect(testHarness.generateMock).toHaveBeenCalledTimes(2);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a todo list.');
    expect(getBuilderState().streamError).toContain('after 2 automatic repair attempts');
    expect(getBuilderState().streamError).toContain('reserved-last-choice-outside-action-mode');
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(1, {
      commitSource: 'streaming',
      committed: false,
      requestId: initialRequestId,
      validationIssues: ['reserved-last-choice-outside-action-mode'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(2, {
      commitSource: 'fallback',
      committed: false,
      requestId: firstRepairRequestId,
      validationIssues: ['reserved-last-choice-outside-action-mode'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(3, {
      commitSource: 'fallback',
      committed: false,
      requestId: secondRepairRequestId,
      validationIssues: ['reserved-last-choice-outside-action-mode'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(4, {
      commitSource: 'streaming',
      committed: false,
      repairOutcome: 'failed',
      requestId: initialRequestId,
      validationIssues: ['reserved-last-choice-outside-action-mode'],
    });
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: GENERATION_FAILED_NOTICE,
        role: 'system',
        technicalDetails: expect.stringContaining('reserved-last-choice-outside-action-mode'),
        tone: 'error',
      }),
    );

    submission.unmount();
  });

  for (const { controlName, invalidSource, prompt, repairedSource } of controlActionAndBindingCases) {
    it(`repairs ${controlName} action mode plus writable binding once and commits the repaired source`, async () => {
      seedCommittedSource();
      setDraftPrompt(prompt);
      const submission = createSubmissionHarness();

      testHarness.streamMock.mockResolvedValue({
        source: invalidSource,
      });
      testHarness.generateMock.mockResolvedValue({
        source: repairedSource,
      });

      await submission.result().handleSubmit(createFormEvent());

      const repairCalls = testHarness.generateMock.mock.calls.filter(([requestOptions]) => {
        const request = (requestOptions as { request: { mode?: string; prompt: string } }).request;
        return request.mode === 'repair' && request.prompt === prompt;
      });

      expect(repairCalls).toHaveLength(1);
      expect((repairCalls[0]?.[0] as { request: { mode?: string } }).request.mode).toBe('repair');
      expect(getBuilderState().committedSource).toBe(repairedSource);
      expect(getBuilderState().streamError).toBeNull();
      expect(findRepairStatusMessages()).toEqual([]);
      expect(getBuilderState().chatMessages.at(-1)).toEqual(
        expect.objectContaining({
          content: 'The first draft had blocking quality issues, so it was repaired automatically before commit.',
          role: 'assistant',
          tone: 'success',
        }),
      );

      submission.unmount();
    });

    it(`fails cleanly after two repairs when ${controlName} still combines action mode with a writable binding`, async () => {
      seedCommittedSource();
      setDraftPrompt(prompt);
      const submission = createSubmissionHarness();

      testHarness.streamMock.mockResolvedValue({
        source: invalidSource,
      });
      testHarness.generateMock.mockResolvedValue({
        source: invalidSource,
      });

      await submission.result().handleSubmit(createFormEvent());

      const repairCalls = testHarness.generateMock.mock.calls.filter(([requestOptions]) => {
        const request = (requestOptions as { request: { mode?: string; prompt: string } }).request;
        return request.mode === 'repair' && request.prompt === prompt;
      });

      expect(repairCalls).toHaveLength(2);
      expect((repairCalls[0]?.[0] as { request: { mode?: string } }).request.mode).toBe('repair');
      expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
      expect(getBuilderState().retryPrompt).toBe(prompt);
      expect(getBuilderState().streamError).toContain('after 2 automatic repair attempts');
      expect(getBuilderState().streamError).toContain('control-action-and-binding');
      expect(findRepairStatusMessages()).toEqual([]);
      expect(getComposerSubmitState(submission)).toEqual({
        disabled: false,
        label: 'Repeat',
        mode: 'repeat',
      });

      submission.unmount();
    });
  }

  it('repairs a logged smoke draft when $lastChoice is used outside action mode', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a complex app with two screens, filtering, a random number button, validation, and a dark theme.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockResolvedValue({
      source: SMOKE_COMPLEX_LAST_CHOICE_SOURCE,
    });
    testHarness.generateMock.mockResolvedValue({
      source: REPAIRED_SMOKE_COMPLEX_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    const repairCalls = testHarness.generateMock.mock.calls.filter(([requestOptions]) => {
      const request = (requestOptions as {
        request: { mode?: string; prompt: string; validationIssues?: Array<{ code: string }> };
      }).request;
      return request.mode === 'repair' && request.prompt === 'Create a complex app with two screens, filtering, a random number button, validation, and a dark theme.';
    });

    expect(repairCalls).toHaveLength(1);
    expect((repairCalls[0]?.[0] as { request: { validationIssues?: Array<{ code: string }> } }).request.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'reserved-last-choice-outside-action-mode' }),
      ]),
    );
    expect(getBuilderState().committedSource).toBe(REPAIRED_SMOKE_COMPLEX_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(findRepairStatusMessages()).toEqual([]);
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'The first draft had blocking quality issues, so it was repaired automatically before commit.',
        role: 'assistant',
        tone: 'success',
      }),
    );

    submission.unmount();
  });

  it('falls back when the stream fails before the first chunk arrives', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.generateMock.mockResolvedValue({
      source: VALID_STREAM_SOURCE,
    });
    testHarness.streamMock.mockRejectedValue(new Error('Streaming response body is not available.'));

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect(testHarness.generateMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        requestKind: 'stream-fallback',
      }),
    );
    expect(getBuilderState().committedSource).toBe(VALID_STREAM_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().streamedSource).toBe(VALID_STREAM_SOURCE);
    expect(getBuilderState().retryPrompt).toBeNull();

    submission.unmount();
  });

  it('does not fall back after the first chunk, even when that chunk is empty', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockImplementationOnce(async ({ onChunk }: { onChunk: (chunk: string) => void }) => {
      onChunk('');
      throw new Error('The model stream ended before it returned any OpenUI source.');
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBe('The model stopped before it returned a usable draft. Please try again.');
    expect(getBuilderState().streamedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a settings app.');

    submission.unmount();
  });

  it('does not fall back after a streamed summary arrives before the first source chunk', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockImplementationOnce(async ({ onSummary }: { onSummary?: (summary: string) => void }) => {
      onSummary?.('Creates a settings app');
      throw new Error('The model stream ended before it returned any OpenUI source.');
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBe('The model stopped before it returned a usable draft. Please try again.');
    expect(getBuilderState().streamedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a settings app.');
    expect(findChatMessage('Creates a settings app')).toBeUndefined();

    submission.unmount();
  });

  it('does not fall back when the stream times out after the first chunk', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockImplementationOnce(async ({ onChunk }: { onChunk: (chunk: string) => void }) => {
      onChunk(SHORT_PARTIAL_DRAFT);
      throw new BuilderStreamTimeoutError('idle');
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBe(new BuilderStreamTimeoutError('idle').message);
    expect(getBuilderState().retryPrompt).toBe('Create a settings app.');

    submission.unmount();
  });

  it('fails when the stream emits too much partial content before ending without done', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockImplementationOnce(async ({ onChunk }: { onChunk: (chunk: string) => void }) => {
      onChunk(LARGE_PARTIAL_DRAFT);
      throw new Error('The model stream ended before it returned any OpenUI source.');
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBe('The model stopped before it returned a usable draft. Please try again.');
    expect(getBuilderState().streamedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a settings app.');

    submission.unmount();
  });

  it('removes the pending streamed summary when the request fails before commit', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockImplementationOnce(async ({ onChunk, onSummary }: { onChunk: (chunk: string) => void; onSummary?: (summary: string) => void }) => {
      onSummary?.('Creates a settings app');
      onChunk(LARGE_PARTIAL_DRAFT);
      throw new Error('The model stream ended before it returned any OpenUI source.');
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(findChatMessage('Creates a settings app')).toBeUndefined();
    expect(getBuilderState().streamError).toBe('The model stopped before it returned a usable draft. Please try again.');

    submission.unmount();
  });

  it('cancels the first request once when a second prompt supersedes it and ignores the late response', async () => {
    setDraftPrompt('Build a simple app.');
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    const dispatchSpy = vi.spyOn(store, 'dispatch');
    const submission = createSubmissionHarness();
    const firstRequest = createDeferred<{ source: string }>();
    const secondRequest = createDeferred<{ source: string }>();
    let firstSignal: AbortSignal | undefined;
    let firstAbortCount = 0;

    testHarness.streamMock
      .mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
        firstSignal = signal;
        signal?.addEventListener(
          'abort',
          () => {
            firstAbortCount += 1;
          },
          { once: true },
        );
        return firstRequest.promise;
      })
      .mockImplementationOnce(() => secondRequest.promise);

    const firstPromise = submission.result().handleSubmit(createFormEvent());
    const firstRequestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;
    const secondPromise = submission.result().handleSubmit(createFormEvent());

    secondRequest.resolve({
      source: SECOND_REQUEST_SOURCE,
    });
    await secondPromise;

    expect(firstSignal?.aborted).toBe(true);
    expect(firstAbortCount).toBe(1);
    expect(getBuilderState().committedSource).toBe(SECOND_REQUEST_SOURCE);

    firstRequest.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await firstPromise;

    const cancelActions = getCancelStreamingActions(dispatchSpy);

    expect(cancelActions).toHaveLength(1);
    expect(cancelActions[0]?.payload.requestId).toBe(firstRequestId);
    expect(findChatMessage(USER_CANCELLED_NOTICE)).toBeUndefined();
    expect(getBuilderState().committedSource).toBe(SECOND_REQUEST_SOURCE);

    submission.unmount();
  });

  it('aborts mid-stream without committing, preserves the last valid preview, and removes the pending summary', async () => {
    seedCommittedSource();
    setDraftPrompt('Build a simple app.');
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    const dispatchSpy = vi.spyOn(store, 'dispatch');
    const submission = createSubmissionHarness();
    const previousHistoryLength = getBuilderState().history.length;
    let abortCount = 0;

    testHarness.streamMock.mockImplementationOnce(
      ({ onChunk, onSummary, signal }: { onChunk: (chunk: string) => void; onSummary?: (summary: string) => void; signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          onSummary?.('Builds a cancellable draft');
          onChunk('partial draft');

          signal?.addEventListener(
            'abort',
            () => {
              abortCount += 1;
              reject(createAbortError());
            },
            { once: true },
          );
        }),
    );

    const requestPromise = submission.result().handleSubmit(createFormEvent());
    await flushMicrotasks();
    const requestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;

    expect(findChatMessage('Builds a cancellable draft')).toEqual(
      expect.objectContaining({
        content: 'Builds a cancellable draft',
        isStreaming: true,
        role: 'assistant',
      }),
    );

    submission.result().handleCancel();
    await requestPromise;
    const cancelActions = getCancelStreamingActions(dispatchSpy);

    expect(abortCount).toBe(1);
    expect(submission.requestControls.abortController).toBeNull();
    expect(cancelActions).toHaveLength(1);
    expect(cancelActions[0]?.payload.requestId).toBe(requestId);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().retryPrompt).toBeNull();
    expect(getBuilderState().currentRequestId).toBeNull();
    expect(getBuilderState().history).toHaveLength(previousHistoryLength);
    expect(findChatMessage('Builds a cancellable draft')).toBeUndefined();
    expect(findChatMessages(USER_CANCELLED_NOTICE)).toHaveLength(1);
    expect(findChatMessages(USER_CANCELLED_NOTICE)[0]).toEqual(
      expect.objectContaining({
        content: USER_CANCELLED_NOTICE,
        role: 'system',
        tone: 'default',
      }),
    );
    expect(getBuilderState().chatMessages.some((message) => message.tone === 'error')).toBe(false);

    submission.unmount();
  });

  it('aborts the fallback non-stream request when the submission is cancelled', async () => {
    seedCommittedSource();
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    let fallbackSignal: AbortSignal | undefined;

    testHarness.streamMock.mockRejectedValue(new Error('Streaming response body is not available.'));
    testHarness.generateMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      fallbackSignal = signal;

      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            reject(createAbortError());
          },
          { once: true },
        );
      });
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());
    await flushMicrotasks();

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);

    submission.result().handleCancel();
    await requestPromise;

    expect(fallbackSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().retryPrompt).toBeNull();
    expect(findChatMessage(USER_CANCELLED_NOTICE)).toEqual(
      expect.objectContaining({
        content: USER_CANCELLED_NOTICE,
        role: 'system',
        tone: 'default',
      }),
    );

    submission.unmount();
  });

  it('cancels the active request once on unmount without adding a user cancel confirmation', async () => {
    seedCommittedSource();
    setDraftPrompt('Build a simple app.');
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    const dispatchSpy = vi.spyOn(store, 'dispatch');
    const submission = createSubmissionHarness();
    let abortCount = 0;

    testHarness.streamMock.mockImplementationOnce(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              abortCount += 1;
              reject(createAbortError());
            },
            { once: true },
          );
        }),
    );

    const requestPromise = submission.result().handleSubmit(createFormEvent());
    await flushMicrotasks();
    const requestId = (testHarness.streamMock.mock.calls[0]?.[0] as { requestId?: string }).requestId;

    submission.unmount();
    await requestPromise;

    const cancelActions = getCancelStreamingActions(dispatchSpy);

    expect(abortCount).toBe(1);
    expect(submission.requestControls.abortController).toBeNull();
    expect(cancelActions).toHaveLength(1);
    expect(cancelActions[0]?.payload.requestId).toBe(requestId);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().currentRequestId).toBeNull();
    expect(findChatMessage(USER_CANCELLED_NOTICE)).toBeUndefined();
    expect(getBuilderState().chatMessages.some((message) => message.tone === 'error')).toBe(false);
  });

  it('aborts the active request when an import starts and keeps the imported source over a late response', async () => {
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.requestControls);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    expect(submission.requestControls.cancelActiveRequestHandler).toBeTypeOf('function');

    await historyControls.result().handleImport(
      createImportEvent({
        name: 'import.json',
        text: async () => createImportPayload(),
      }),
    );

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(IMPORTED_SOURCE);
    expect(getBuilderState().currentRequestId).toBeNull();

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(IMPORTED_SOURCE);
    expect(findChatMessage(USER_CANCELLED_NOTICE)).toBeUndefined();

    historyControls.unmount();
    submission.unmount();
  });

  it('restores the matching runtime and domain snapshot on undo and redo', () => {
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    const undoSnapshot = createBuilderSnapshot(
      UNDO_SOURCE,
      {
        currentScreen: 'undo',
        draftName: 'First version',
      },
      {
        app: {
          tasks: ['one'],
        },
      },
      {
        appMemory: {
          version: 1,
          appSummary: 'Undo memory.',
          userPreferences: ['Undo preference.'],
          avoid: [],
        },
      },
    );
    const redoSnapshot = createBuilderSnapshot(
      REDO_SOURCE,
      {
        currentScreen: 'redo',
        draftName: 'Second version',
      },
      {
        app: {
          tasks: ['one', 'two'],
        },
      },
      {
        appMemory: {
          version: 1,
          appSummary: 'Redo memory.',
          userPreferences: ['Redo preference.'],
          avoid: ['Avoid undo-only controls.'],
        },
      },
    );
    const latestRuntimeState = {
      currentScreen: 'redo',
      draftName: 'Second version',
      isDirty: true,
    };
    const latestDomainData = {
      app: {
        tasks: ['one', 'two', 'three'],
      },
    };

    seedHistorySnapshots(undoSnapshot, redoSnapshot);
    const historyControls = createHistoryControlsHarness();

    store.dispatch(builderSessionActions.replaceRuntimeSessionState(latestRuntimeState));
    store.dispatch(builderActions.syncLatestSnapshotState({ runtimeState: latestRuntimeState }));
    store.dispatch(domainActions.replaceData(latestDomainData));
    store.dispatch(builderActions.syncLatestSnapshotState({ domainData: latestDomainData }));

    historyControls.rerender().handleUndo();

    expect(getBuilderState().committedSource).toBe(UNDO_SOURCE);
    expect(getBuilderState().appMemory).toEqual(undoSnapshot.appMemory);
    expect(getBuilderSessionState()).toEqual(undoSnapshot.runtimeState);
    expect(getDomainState()).toEqual(undoSnapshot.domainData);

    historyControls.rerender().handleRedo();

    expect(getBuilderState().committedSource).toBe(REDO_SOURCE);
    expect(getBuilderState().appMemory).toEqual(redoSnapshot.appMemory);
    expect(getBuilderSessionState()).toEqual(latestRuntimeState);
    expect(getDomainState()).toEqual(latestDomainData);

    historyControls.unmount();
  });

  it('disables undo while a request is active and lets the generation finish', async () => {
    seedHistorySources(UNDO_SOURCE, REDO_SOURCE);
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.requestControls);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const staleHistoryControls = historyControls.result();
    const requestPromise = submission.result().handleSubmit(createFormEvent());
    const activeHistoryControls = historyControls.rerender();

    expect(activeHistoryControls.canUndo).toBe(false);

    staleHistoryControls.handleUndo();
    activeHistoryControls.handleUndo();

    expect(requestSignal?.aborted).toBe(false);
    expect(getBuilderState().committedSource).toBe(REDO_SOURCE);
    expect(getBuilderState().currentRequestId).not.toBeNull();

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(FIRST_REQUEST_LATE_SOURCE);

    historyControls.unmount();
    submission.unmount();
  });

  it('disables redo while a request is active and lets the generation finish', async () => {
    seedHistorySources(UNDO_SOURCE, REDO_SOURCE);
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    store.dispatch(builderActions.undoLatest());
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.requestControls);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const staleHistoryControls = historyControls.result();
    const requestPromise = submission.result().handleSubmit(createFormEvent());
    const activeHistoryControls = historyControls.rerender();

    expect(activeHistoryControls.canRedo).toBe(false);

    staleHistoryControls.handleRedo();
    activeHistoryControls.handleRedo();

    expect(requestSignal?.aborted).toBe(false);
    expect(getBuilderState().committedSource).toBe(UNDO_SOURCE);
    expect(getBuilderState().currentRequestId).not.toBeNull();

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(FIRST_REQUEST_LATE_SOURCE);

    historyControls.unmount();
    submission.unmount();
  });

  it('disables reset while a request is active and lets the generation finish', async () => {
    seedCommittedSource(PREVIOUS_SOURCE);
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.requestControls);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const staleHistoryControls = historyControls.result();
    const requestPromise = submission.result().handleSubmit(createFormEvent());
    const activeHistoryControls = historyControls.rerender();

    expect(activeHistoryControls.canReset).toBe(false);

    staleHistoryControls.handleResetToEmpty();
    activeHistoryControls.handleResetToEmpty();

    expect(requestSignal?.aborted).toBe(false);
    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().currentRequestId).not.toBeNull();

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(FIRST_REQUEST_LATE_SOURCE);

    historyControls.unmount();
    submission.unmount();
  });
});
