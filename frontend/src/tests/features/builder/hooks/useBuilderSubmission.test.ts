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

    useCallback<Callback extends (...args: never[]) => unknown>(callback: Callback) {
      this.cursor += 1;
      return callback;
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
  }

  return {
    HookRuntime,
    activeRuntimeRef,
    commitTelemetryMock: vi.fn(),
    configRef: { current: undefined as unknown },
    generateMock: vi.fn(),
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
      void deps;
      return getRuntime().useCallback(callback);
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => getRuntime().useEffect(effect, deps),
    useRef: <Value>(initialValue: Value) => getRuntime().useRef(initialValue),
  };
});

vi.mock('@api/apiSlice', () => ({
  useConfigQuery: () => ({
    data: testHarness.configRef.current,
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

vi.mock('@store/errorRecovery', () => ({
  resetAppState: () => {
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    store.dispatch({ type: 'domain/resetDomainState' });
    store.dispatch({ type: 'builderSession/resetRuntimeSessionState' });
    store.dispatch({ type: 'builder/resetToEmpty' });
  },
}));

vi.mock('@features/builder/api/generateDefinition', () => ({
  generateBuilderDefinition: (...args: Parameters<typeof testHarness.generateMock>) => testHarness.generateMock(...args),
}));

vi.mock('@features/builder/api/streamGenerate', () => {
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

vi.mock('@features/builder/api/commitTelemetry', () => ({
  postCommitTelemetry: (...args: Parameters<typeof testHarness.commitTelemetryMock>) => testHarness.commitTelemetryMock(...args),
}));

import { builderActions, builderReducer } from '@features/builder/store/builderSlice';
import { builderSessionActions, builderSessionReducer } from '@features/builder/store/builderSessionSlice';
import { domainActions, domainReducer } from '@features/builder/store/domainSlice';
import { getBuilderComposerSubmitState } from '@features/builder/hooks/submissionPrompt';
import { createBuilderSnapshot } from '@features/builder/openui/runtime/persistedState';
import { useBuilderHistoryControls } from '@features/builder/hooks/useBuilderHistoryControls';
import { useBuilderSubmission } from '@features/builder/hooks/useBuilderSubmission';

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
    Text("Todo list", "title", "start"),
    Text("Start by describing your tasks here.", "body", "start")
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
  limits: {
    chatHistoryMaxItems: 40,
    promptMaxChars: 4_096,
    requestMaxBytes: 300_000,
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

function createSubmissionHarness() {
  const abortControllerRef = { current: null as AbortController | null };
  const cancelActiveRequestRef = { current: null as (() => void) | null };
  const onSystemNotice = vi.fn();
  const runtime = new testHarness.HookRuntime();
  const options = {
    abortControllerRef,
    cancelActiveRequestRef,
    onSystemNotice,
  };
  let result = runtime.render(() => useBuilderSubmission(options));

  return {
    abortControllerRef,
    cancelActiveRequestRef,
    onSystemNotice,
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

function createHistoryControlsHarness(cancelActiveRequestRef: { current: (() => void) | null }) {
  const onSystemNotice = vi.fn();
  const runtime = new testHarness.HookRuntime();
  const options = {
    cancelActiveRequestRef,
    onSystemNotice,
  };
  let result = runtime.render(() => useBuilderHistoryControls(options));

  return {
    onSystemNotice,
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

function createImportPayload(source = IMPORTED_SOURCE) {
  return JSON.stringify({
    domainData: {},
    history: [],
    runtimeState: {},
    source,
    version: 1,
  });
}

function findChatMessage(content: string) {
  return getBuilderState().chatMessages.find((message) => message.content === content);
}

function getComposerSubmitState(submission: ReturnType<typeof createSubmissionHarness>) {
  const result = submission.rerender();

  return getBuilderComposerSubmitState({
    draftPrompt: result.draftPrompt,
    hasCommittedSource: getBuilderState().committedSource.trim().length > 0,
    isSubmitting: result.isSubmitting,
    retryPrompt: result.retryPrompt,
  });
}

beforeEach(() => {
  testHarness.commitTelemetryMock.mockReset();
  testHarness.storeRef.current = createTestStore();
  testHarness.configRef.current = DEFAULT_CONFIG;
  testHarness.streamMock.mockReset();
  testHarness.generateMock.mockReset();
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
      requestId: initialRequestId,
      validationIssues: [],
    });
    expect(getBuilderState().committedSource).toBe(VALID_STREAM_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().history).toHaveLength(2);
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Updated the app definition from the latest chat instruction.',
        role: 'assistant',
        tone: 'success',
      }),
    );

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

    expect(findChatMessage('Building: Adds a welcome…')).toEqual(
      expect.objectContaining({
        content: 'Building: Adds a welcome…',
        role: 'assistant',
      }),
    );

    streamResult.resolve({
      source: VALID_STREAM_SOURCE,
      summary: 'Adds a welcome screen',
    });
    await requestPromise;

    expect(findChatMessage('Building: Adds a welcome…')).toBeUndefined();
    expect(findChatMessage('Adds a welcome screen')).toEqual(
      expect.objectContaining({
        content: 'Adds a welcome screen',
        excludeFromLlmContext: undefined,
        role: 'assistant',
      }),
    );
    expect(getBuilderState().chatMessages.some((message) => message.content === 'Updated the app definition from the latest chat instruction.')).toBe(
      false,
    );

    setDraftPrompt('Create a settings app.');

    testHarness.streamMock.mockImplementationOnce(
      async ({ onChunk, onSummary }: { onChunk: (chunk: string) => void; onSummary?: (summary: string) => void }) => {
        onSummary?.('Creates a settings app');
        onChunk('partial draft');
        throw new Error('The model stream ended before it returned any OpenUI source.');
      },
    );

    await submission.rerender().handleSubmit(createFormEvent());

    expect(findChatMessage('Building: Creates a settings app…')).toBeUndefined();
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
    expect(getBuilderState().isStreaming).toBe(false);
    expect(getBuilderState().committedSource).toBe('x'.repeat(512));

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
    expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeTruthy();
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'The first draft had parser issues, so it was repaired automatically before commit.',
        role: 'assistant',
        tone: 'success',
      }),
    );

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
    expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeUndefined();

    submission.unmount();
  });

  it('commits a locally auto-fixed draft without sending a repair request and logs the local fix', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    testHarness.streamMock.mockResolvedValue({
      source: AUTO_FIXABLE_SOURCE,
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(testHarness.streamMock).toHaveBeenCalledTimes(1);
    expect(testHarness.generateMock).not.toHaveBeenCalled();
    expect(getBuilderState().committedSource).toBe(AUTO_FIXED_SOURCE);
    expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeUndefined();
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('auto-fixed locally'));

    consoleInfoSpy.mockRestore();
    submission.unmount();
  });

  it('keeps the previous source when parser repair stays invalid', async () => {
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

    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a todo list.');
    expect(getBuilderState().streamError).toContain('after 1 automatic repair attempt');
    expect(getBuilderState().streamError).toContain('incomplete-source');
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: expect.stringContaining('after 1 automatic repair attempt'),
        role: 'system',
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

    expect(testHarness.generateMock).toHaveBeenCalledTimes(1);
    expect((testHarness.generateMock.mock.calls[0]?.[0] as { request: { mode?: string } }).request.mode).toBe('repair');
    expect(getBuilderState().committedSource).toBe(VALID_TODO_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeTruthy();
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
      request: { mode?: string; prompt: string; validationIssues?: string[] };
      requestId?: string;
    };
    const repairRequest = repairCall.request;

    expect(repairCall.requestId).not.toBe(initialRequestId);
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(1, {
      commitSource: 'streaming',
      committed: false,
      requestId: initialRequestId,
      validationIssues: ['undefined-state-reference'],
    });
    expect(testHarness.commitTelemetryMock).toHaveBeenNthCalledWith(2, {
      commitSource: 'fallback',
      committed: true,
      requestId: repairCall.requestId,
      validationIssues: [],
    });

    expect(repairRequest.mode).toBe('repair');
    expect(repairRequest.validationIssues).toContain('undefined-state-reference');
    expect(repairRequest.prompt).toContain('$currentScreen');
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
      request: { mode?: string; parentRequestId?: string; prompt: string; validationIssues?: string[] };
    }).request;

    expect(repairRequest.mode).toBe('repair');
    expect(repairRequest.parentRequestId).toBe(initialRequestId);
    expect(repairRequest.validationIssues).toEqual([
      'item-bound-control-without-action',
      'mutation-uses-array-index-path',
    ]);
    expect(repairRequest.prompt).toContain('item-bound-control-without-action');
    expect(repairRequest.prompt).toContain('mutation-uses-array-index-path');
    expect(getBuilderState().committedSource).toBe(VALID_STREAM_SOURCE);

    submission.unmount();
  });

  it('keeps the previous source when a repaired quality-blocked draft is still blocked', async () => {
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

    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().retryPrompt).toBe('Create a todo list.');
    expect(getBuilderState().streamError).toContain('after 1 automatic repair attempt');
    expect(getBuilderState().streamError).toContain('quality-missing-todo-controls');
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: expect.stringContaining('quality-missing-todo-controls'),
        role: 'system',
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
        return request.mode === 'repair' && request.prompt.includes(prompt);
      });

      expect(repairCalls).toHaveLength(1);
      expect((repairCalls[0]?.[0] as { request: { mode?: string } }).request.mode).toBe('repair');
      expect(getBuilderState().committedSource).toBe(repairedSource);
      expect(getBuilderState().streamError).toBeNull();
      expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeTruthy();
      expect(getBuilderState().chatMessages.at(-1)).toEqual(
        expect.objectContaining({
          content: 'The first draft had blocking quality issues, so it was repaired automatically before commit.',
          role: 'assistant',
          tone: 'success',
        }),
      );

      submission.unmount();
    });

    it(`fails cleanly after one repair when ${controlName} still combines action mode with a writable binding`, async () => {
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
        return request.mode === 'repair' && request.prompt.includes(prompt);
      });

      expect(repairCalls).toHaveLength(1);
      expect((repairCalls[0]?.[0] as { request: { mode?: string } }).request.mode).toBe('repair');
      expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
      expect(getBuilderState().retryPrompt).toBe(prompt);
      expect(getBuilderState().streamError).toContain('after 1 automatic repair attempt');
      expect(getBuilderState().streamError).toContain('control-action-and-binding');
      expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeTruthy();
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
        request: { mode?: string; prompt: string; validationIssues?: string[] };
      }).request;
      return request.mode === 'repair' && request.prompt.includes('Create a complex app with two screens');
    });

    expect(repairCalls).toHaveLength(1);
    expect((repairCalls[0]?.[0] as { request: { validationIssues?: string[] } }).request.validationIssues).toEqual(
      expect.arrayContaining([
        'quality-random-result-not-visible',
        'reserved-last-choice-outside-action-mode',
      ]),
    );
    expect(getBuilderState().committedSource).toBe(REPAIRED_SMOKE_COMPLEX_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(findChatMessage('The model returned a draft that cannot be committed yet. Sending one automatic repair request now.')).toBeTruthy();
    expect(getBuilderState().chatMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'The first draft had blocking quality issues, so it was repaired automatically before commit.',
        role: 'assistant',
        tone: 'success',
      }),
    );

    submission.unmount();
  });

  it('fails when the stream emits chunks but never finishes with done', async () => {
    seedCommittedSource();
    setDraftPrompt('Create a settings app.');
    const submission = createSubmissionHarness();

    testHarness.streamMock.mockImplementationOnce(async ({ onChunk }: { onChunk: (chunk: string) => void }) => {
      onChunk('{"source":"partial"}');
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
      onChunk('partial draft');
      throw new Error('The model stream ended before it returned any OpenUI source.');
    });

    await submission.result().handleSubmit(createFormEvent());

    expect(findChatMessage('Building: Creates a settings app…')).toBeUndefined();
    expect(findChatMessage('Creates a settings app')).toBeUndefined();
    expect(getBuilderState().streamError).toBe('The model stopped before it returned a usable draft. Please try again.');

    submission.unmount();
  });

  it('ignores a late response from the first request after a second request supersedes it', async () => {
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const firstRequest = createDeferred<{ source: string }>();
    const secondRequest = createDeferred<{ source: string }>();
    let firstSignal: AbortSignal | undefined;

    testHarness.streamMock
      .mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
        firstSignal = signal;
        return firstRequest.promise;
      })
      .mockImplementationOnce(() => secondRequest.promise);

    const firstPromise = submission.result().handleSubmit(createFormEvent());
    const secondPromise = submission.result().handleSubmit(createFormEvent());

    secondRequest.resolve({
      source: SECOND_REQUEST_SOURCE,
    });
    await secondPromise;

    expect(firstSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(SECOND_REQUEST_SOURCE);

    firstRequest.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await firstPromise;

    expect(getBuilderState().committedSource).toBe(SECOND_REQUEST_SOURCE);

    submission.unmount();
  });

  it('aborts mid-stream without committing, preserves the last valid preview, and removes the pending summary', async () => {
    seedCommittedSource();
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const previousHistoryLength = getBuilderState().history.length;

    testHarness.streamMock.mockImplementationOnce(
      ({ onChunk, onSummary, signal }: { onChunk: (chunk: string) => void; onSummary?: (summary: string) => void; signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          onSummary?.('Builds a cancellable draft');
          onChunk('partial draft');

          signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true },
          );
        }),
    );

    const requestPromise = submission.result().handleSubmit(createFormEvent());
    await flushMicrotasks();

    expect(findChatMessage('Building: Builds a cancellable draft…')).toEqual(
      expect.objectContaining({
        content: 'Building: Builds a cancellable draft…',
        role: 'assistant',
      }),
    );

    submission.result().handleCancel();
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamedSource).toBe(PREVIOUS_SOURCE);
    expect(getBuilderState().streamError).toBeNull();
    expect(getBuilderState().retryPrompt).toBeNull();
    expect(getBuilderState().currentRequestId).toBeNull();
    expect(getBuilderState().history).toHaveLength(previousHistoryLength);
    expect(findChatMessage('Building: Builds a cancellable draft…')).toBeUndefined();
    expect(findChatMessage('Builds a cancellable draft')).toBeUndefined();
    expect(findChatMessage(USER_CANCELLED_NOTICE)).toEqual(
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

  it('aborts the active request when an import starts and keeps the imported source over a late response', async () => {
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.cancelActiveRequestRef);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    expect(submission.cancelActiveRequestRef.current).toBeTypeOf('function');

    await historyControls.result().handleImport(
      createImportEvent({
        name: 'import.json',
        text: async () => createImportPayload(),
      }),
    );

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(IMPORTED_SOURCE);
    expect(getBuilderState().isStreaming).toBe(false);

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
    const historyControls = createHistoryControlsHarness({ current: null });

    store.dispatch(builderSessionActions.replaceRuntimeSessionState(latestRuntimeState));
    store.dispatch(builderActions.syncLatestSnapshotState({ runtimeState: latestRuntimeState }));
    store.dispatch(domainActions.replaceData(latestDomainData));
    store.dispatch(builderActions.syncLatestSnapshotState({ domainData: latestDomainData }));

    historyControls.rerender().handleUndo();

    expect(getBuilderState().committedSource).toBe(UNDO_SOURCE);
    expect(getBuilderSessionState()).toEqual(undoSnapshot.runtimeState);
    expect(getDomainState()).toEqual(undoSnapshot.domainData);

    historyControls.rerender().handleRedo();

    expect(getBuilderState().committedSource).toBe(REDO_SOURCE);
    expect(getBuilderSessionState()).toEqual(latestRuntimeState);
    expect(getDomainState()).toEqual(latestDomainData);

    historyControls.unmount();
  });

  it('aborts the active request when undo starts and keeps the undone source over a late response', async () => {
    seedHistorySources(UNDO_SOURCE, REDO_SOURCE);
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.cancelActiveRequestRef);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    historyControls.result().handleUndo();

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(UNDO_SOURCE);
    expect(getBuilderState().isStreaming).toBe(false);

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(UNDO_SOURCE);

    historyControls.unmount();
    submission.unmount();
  });

  it('aborts the active request when redo starts and keeps the redone source over a late response', async () => {
    seedHistorySources(UNDO_SOURCE, REDO_SOURCE);
    const store = testHarness.storeRef.current;

    if (!store) {
      throw new Error('Test store is not initialized.');
    }

    store.dispatch(builderActions.undoLatest());
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.cancelActiveRequestRef);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    historyControls.result().handleRedo();

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe(REDO_SOURCE);
    expect(getBuilderState().isStreaming).toBe(false);

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe(REDO_SOURCE);

    historyControls.unmount();
    submission.unmount();
  });

  it('aborts the active request when reset starts and keeps the reset canvas over a late response', async () => {
    seedCommittedSource(PREVIOUS_SOURCE);
    setDraftPrompt('Build a simple app.');
    const submission = createSubmissionHarness();
    const historyControls = createHistoryControlsHarness(submission.cancelActiveRequestRef);
    const streamResult = createDeferred<{ source: string }>();
    let requestSignal: AbortSignal | undefined;

    testHarness.streamMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      requestSignal = signal;
      return streamResult.promise;
    });

    const requestPromise = submission.result().handleSubmit(createFormEvent());

    historyControls.result().handleResetToEmpty();

    expect(requestSignal?.aborted).toBe(true);
    expect(getBuilderState().committedSource).toBe('');
    expect(getBuilderState().isStreaming).toBe(false);

    streamResult.resolve({
      source: FIRST_REQUEST_LATE_SOURCE,
    });
    await requestPromise;

    expect(getBuilderState().committedSource).toBe('');

    historyControls.unmount();
    submission.unmount();
  });
});
