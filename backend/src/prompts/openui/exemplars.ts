import { promptRequiresBlockingTodoControls } from './qualityIntents.js';
import type { PromptBuildValidationIssue } from './types.js';

export interface PromptExemplar {
  key: string;
  text: string;
  title: string;
}

const TODO_REQUEST_EXEMPLAR: PromptExemplar = {
  key: 'todo-task-list',
  title: 'Todo/task list pattern',
  text: `$draft = ""
$targetItemId = ""

items = Query("read_state", { path: "app.items" }, [])
addItem = Mutation("append_item", {
  path: "app.items",
  value: { title: $draft, completed: false }
})
toggleItem = Mutation("toggle_item_field", {
  path: "app.items",
  idField: "id",
  id: $targetItemId,
  field: "completed"
})
rows = @Each(items, "item", Group(null, "horizontal", [
  Text(item.title, "body", "start"),
  Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
], "inline"))

root = AppShell([
  Screen("main", "Todo list", [
    Group("Add task", "horizontal", [
      Input("draft", "Task", $draft, "New task"),
      Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")
    ], "inline"),
    Repeater(rows, "No tasks yet.")
  ])
])`,
};

const REPAIR_EXEMPLARS: Record<string, PromptExemplar> = {
  'control-action-and-binding': {
    key: 'control-action-and-binding',
    title: 'Action mode vs binding mode',
    text: `WRONG: Checkbox("toggle-" + item.id, "", $checked, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))
OK: Checkbox("toggle-" + item.id, "", item.completed, null, null, Action([@Set($targetItemId, item.id), @Run(toggleItem), @Run(items)]))`,
  },
  'inline-tool-in-each': {
    key: 'inline-tool-hoist',
    title: 'Hoist tools out of @Each(...)',
    text: `WRONG: @Each(items, "item", Mutation("append_item", { path: "app.items", value: { title: item.title } }))
OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft } })
OK: @Each(items, "item", Button("save-" + item.id, "Save", "default", Action([@Run(addItem)]), false))`,
  },
  'inline-tool-in-prop': {
    key: 'inline-tool-hoist',
    title: 'Hoist tools out of component props',
    text: `WRONG: Button("save", "Save", "default", Action([@Run(Mutation("append_item", { path: "app.items", value: { title: $draft } }))]), false)
OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft } })
OK: Button("save", "Save", "default", Action([@Run(addItem)]), false)`,
  },
  'inline-tool-in-repeater': {
    key: 'inline-tool-hoist',
    title: 'Hoist tools before Repeater(...)',
    text: `WRONG: Repeater([Mutation("append_item", { path: "app.items", value: { title: $draft } })], "No items")
OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft } })
OK: Repeater(rows, "No items")`,
  },
  'quality-missing-todo-controls': {
    key: 'quality-missing-todo-controls',
    title: 'Interactive todo pattern',
    text: `WRONG: root = AppShell([Screen("main", "Todo", [Text("Todo", "title", "start")])])
OK: $draft = ""
OK: items = Query("read_state", { path: "app.items" }, [])
OK: addItem = Mutation("append_item", { path: "app.items", value: { title: $draft, completed: false } })
OK: rows = @Each(items, "item", ...)
OK: Repeater(rows, "No tasks yet.")`,
  },
  'quality-options-shape': {
    key: 'quality-options-shape',
    title: 'Option object shape',
    text: `WRONG: ["Email", "Phone"]
OK: [{ label: "Email", value: "email" }, { label: "Phone", value: "phone" }]`,
  },
  'quality-stale-persisted-query': {
    key: 'quality-stale-persisted-query',
    title: 'Refresh visible query after mutation',
    text: `WRONG: Button("add-task", "Add", "default", Action([@Run(addItem), @Reset($draft)]), $draft == "")
OK: Button("add-task", "Add", "default", Action([@Run(addItem), @Run(items), @Reset($draft)]), $draft == "")`,
  },
  'reserved-last-choice-outside-action-mode': {
    key: 'reserved-last-choice-outside-action-mode',
    title: 'Use $lastChoice only inside action-mode flows',
    text: `WRONG: Text("Selected filter: " + $lastChoice, "body", "start")
OK: setFilter = Mutation("write_state", { path: "ui.filter", value: $lastChoice })
OK: Select("filter", "Filter", savedFilter, filterOptions, null, [], Action([@Run(setFilter), @Run(savedFilter)]))`,
  },
  'undefined-state-reference': {
    key: 'undefined-state-reference',
    title: 'Declare missing $state before root',
    text: `WRONG: root = AppShell([Screen("main", "Draft", [Text($draft, "body", "start")])])
OK: $draft = ""
OK: root = AppShell([Screen("main", "Draft", [Text($draft, "body", "start")])])`,
  },
};

function dedupeExemplars(exemplars: PromptExemplar[]) {
  const seenKeys = new Set<string>();
  return exemplars.filter((exemplar) => {
    if (seenKeys.has(exemplar.key)) {
      return false;
    }

    seenKeys.add(exemplar.key);
    return true;
  });
}

export function getRelevantRepairExemplars(issues: PromptBuildValidationIssue[]) {
  return dedupeExemplars(
    issues
      .map((issue) => REPAIR_EXEMPLARS[issue.code])
      .filter((exemplar): exemplar is PromptExemplar => exemplar != null),
  );
}

export function getRelevantRequestExemplars(userPrompt: string) {
  const exemplars: PromptExemplar[] = [];

  if (promptRequiresBlockingTodoControls(userPrompt)) {
    exemplars.push(TODO_REQUEST_EXEMPLAR);
  }

  return dedupeExemplars(exemplars);
}
