export const TODO_TASK_LIST_REQUEST_EXEMPLAR_TEXT = `$draft = ""
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
])`;

