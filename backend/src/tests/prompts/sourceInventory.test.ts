import { describe, expect, it } from 'vitest';
import { buildCurrentSourceInventory } from '#backend/prompts/openui.js';

describe('buildCurrentSourceInventory', () => {
  it('summarizes screens, tool statements, runtime state, and persisted paths', () => {
    const inventory = buildCurrentSourceInventory(`$draft = ""
$targetTaskId = ""
$filter = "all"
savedFilter = Query("read_state", { path: "ui.filter" }, "all")
tasks = Query("read_state", { path: "app.tasks" }, [])
setFilter = Mutation("write_state", { path: "ui.filter", value: $lastChoice })
addTask = Mutation("append_item", {
  path: "app.tasks",
  value: { title: $draft, completed: false }
})
toggleTask = Mutation("toggle_item_field", {
  path: "app.tasks",
  idField: "id",
  id: $targetTaskId,
  field: "completed"
})
rows = @Each(tasks, "task", Group(task.title, "horizontal", [
  Text(task.title, "body", "start")
], "inline"))
root = AppShell([
  Screen("home", "Tasks", [
    Select("filter", "Show", savedFilter, [{ label: "All", value: "all" }], null, [], Action([@Run(setFilter), @Run(savedFilter)])),
    Repeater(rows, "No tasks")
  ]),
  Screen("details", "Details", [])
])`);

    expect(inventory).toBe(
      [
        'statements: rows, root',
        'screens: home, details',
        'queries: savedFilter -> read_state(ui.filter), tasks -> read_state(app.tasks)',
        'mutations: setFilter -> write_state(ui.filter), addTask -> append_item(app.tasks), toggleTask -> toggle_item_field(app.tasks)',
        'runtime_state: $draft, $targetTaskId, $filter',
        'domain_paths: ui.filter, app.tasks',
      ].join('\n'),
    );
  });

  it('returns null for blank or unusable source', () => {
    expect(buildCurrentSourceInventory('   ')).toBeNull();
    expect(buildCurrentSourceInventory('root = MissingComponent([])')).toBeNull();
    expect(buildCurrentSourceInventory('root = AppShell([')).toBeNull();
  });

  it('keeps a simple source useful and explicit', () => {
    expect(buildCurrentSourceInventory('root = AppShell([])')).toBe(
      [
        'statements: root',
        'screens: none',
        'queries: none',
        'mutations: none',
        'runtime_state: none',
        'domain_paths: none',
      ].join('\n'),
    );
  });

  it('caps long inventory lists', () => {
    const stateDeclarations = Array.from({ length: 34 }, (_, index) => `$value${index} = ""`).join('\n');
    const source = `${stateDeclarations}
root = AppShell([])`;

    expect(buildCurrentSourceInventory(source)).toContain(
      'runtime_state: $value0, $value1, $value2, $value3, $value4, $value5, $value6, $value7, $value8, $value9, $value10, $value11, $value12, $value13, $value14, $value15, $value16, $value17, $value18, $value19, $value20, $value21, $value22, $value23, $value24, $value25, $value26, $value27, $value28, $value29, ... +4 more',
    );
  });
});
