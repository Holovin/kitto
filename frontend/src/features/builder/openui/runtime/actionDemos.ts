export const OPENUI_ACTION_DEMO_EXAMPLES: Record<string, string> = {
  read_state: `// Read a value from persisted state.
savedName = Query("read_state", { path: "app.name" }, "")

// Show the saved value in the UI.
Text(savedName == "" ? "No saved name" : savedName, "body", "start")`,
  compute_value: `// Compute a safe boolean for UI copy or visibility.
nameValid = Query("compute_value", {
  op: "not_empty",
  input: $name,
  returnType: "boolean"
}, { value: false })

Text(nameValid.value ? "Name looks good." : "Name is required.", "body", "start")`,
  write_computed_state: `// Compute a random integer and persist it for later reads.
rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 6 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

Button("roll-dice", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false)
Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")`,
  write_state: `// Write the current input value into persisted state.
savedName = Query("read_state", { path: "app.name" }, "")
saveName = Mutation("write_state", {
  path: "app.name",
  value: $name
})

// Run the mutation, then refresh the visible query.
Button("save-name", "Save", "default", Action([@Run(saveName), @Run(savedName)]), false)`,
  merge_state: `// Patch only the fields you want to change.
savedProfile = Query("read_state", { path: "app.profile" }, { name: "" })
updateProfile = Mutation("merge_state", {
  path: "app.profile",
  patch: { name: $name }
})

// Apply the partial update, then refresh the visible query.
Button("update-profile", "Update profile", "default", Action([@Run(updateProfile), @Run(savedProfile)]), false)`,
  append_state: `// Add a new item to a persisted array.
tasks = Query("read_state", { path: "app.tasks" }, [])
addTask = Mutation("append_state", {
  path: "app.tasks",
  value: { title: $taskTitle, completed: false }
})

// Append the item, then refresh the visible query.
Button("add-task", "Add task", "default", Action([@Run(addTask), @Run(tasks)]), false)`,
  append_item: `// Append a plain-object row and ensure it has a unique stable id.
tasks = Query("read_state", { path: "app.tasks" }, [])
addTask = Mutation("append_item", {
  path: "app.tasks",
  value: { title: $taskTitle, completed: false }
})

// Append the item, then refresh the visible query.
Button("add-task", "Add", "default", Action([@Run(addTask), @Run(tasks), @Reset($taskTitle)]), $taskTitle == "")`,
  toggle_item_field: `// Relay the current row id through local state, then toggle a persisted boolean field.
$targetTaskId = ""
tasks = Query("read_state", { path: "app.tasks" }, [])
toggleTask = Mutation("toggle_item_field", {
  path: "app.tasks",
  idField: "id",
  id: $targetTaskId,
  field: "completed"
})

rows = @Each(tasks, "task", Group(null, "horizontal", [
  Text(task.title, "body", "start"),
  Button("toggle-" + task.id, task.completed ? "Mark open" : "Mark done", "secondary", Action([@Set($targetTaskId, task.id), @Run(toggleTask), @Run(tasks)]), false)
], "inline"))`,
  update_item_field: `// Update one field on a persisted row matched by id.
$targetTaskId = ""
tasks = Query("read_state", { path: "app.tasks" }, [])
renameTask = Mutation("update_item_field", {
  path: "app.tasks",
  idField: "id",
  id: $targetTaskId,
  field: "title",
  value: $taskTitle
})

Button("rename-task", "Rename", "secondary", Action([@Run(renameTask), @Run(tasks)]), $taskTitle == "")`,
  remove_item: `// Remove one persisted row by id instead of by array index.
$targetTaskId = ""
tasks = Query("read_state", { path: "app.tasks" }, [])
removeTask = Mutation("remove_item", {
  path: "app.tasks",
  idField: "id",
  id: $targetTaskId
})

rows = @Each(tasks, "task", Group(null, "horizontal", [
  Text(task.title, "body", "start"),
  Button("remove-" + task.id, "Remove", "destructive", Action([@Set($targetTaskId, task.id), @Run(removeTask), @Run(tasks)]), false)
], "inline"))`,
  remove_state: `// Remove one item from a persisted array.
tasks = Query("read_state", { path: "app.tasks" }, [])
removeFirstTask = Mutation("remove_state", {
  path: "app.tasks",
  index: 0
})

// Delete the first item, then refresh the visible query.
Button("remove-first", "Remove first", "destructive", Action([@Run(removeFirstTask), @Run(tasks)]), false)`,
};
