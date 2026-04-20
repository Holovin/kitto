import { COMPUTE_OPS, COMPUTE_RETURN_TYPES } from './computeTools';

interface OpenUiActionDefinition {
  demoExample: string;
  documentation: {
    returns: string;
    summary: string;
    useWhen: string;
  };
  inputSchema: Record<string, unknown>;
  name: string;
  shortDescription: string;
  signature: string;
}

export const OPENUI_ACTION_DEFINITIONS: OpenUiActionDefinition[] = [
  {
    demoExample: `// Read a value from persisted state.
savedName = Query("read_state", { path: "app.name" }, "")

// Show the saved value in the UI.
Text(savedName == "" ? "No saved name" : savedName, "body", "start")`,
    documentation: {
      summary: 'Reads the current persisted value stored at the requested non-empty state path.',
      useWhen: 'Use this when a component needs to inspect domain data before rendering or before deciding the next action. Use dot-path segments made of letters, numbers, `_`, or `-` only.',
      returns: 'Returns the value at the requested path, or null when nothing is stored there.',
    },
    name: 'read_state',
    shortDescription: 'Read stored value',
    signature: 'read_state(path)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
      },
      required: ['path'],
    },
  },
  {
    demoExample: `// Compute a safe boolean for UI copy or visibility.
nameValid = Query("compute_value", {
  op: "not_empty",
  input: $name,
  returnType: "boolean"
}, { value: false })

Text(nameValid.value ? "Name looks good." : "Name is required.", "body", "start")`,
    documentation: {
      summary: 'Runs a safe primitive-only calculation and returns an object shaped like `{ value }`.',
      useWhen: 'Use this for simple boolean, number, string, random-int, or date calculations that OpenUI built-ins and normal expressions do not already cover well.',
      returns: 'Returns `{ value }`, where `value` is always a primitive string, number, or boolean.',
    },
    name: 'compute_value',
    shortDescription: 'Compute primitive value',
    signature: 'compute_value(op, input?, left?, right?, values?, options?, returnType?)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: {
          type: 'string',
          enum: [...COMPUTE_OPS],
        },
        input: {},
        left: {},
        right: {},
        values: {
          type: 'array',
          items: {},
        },
        options: {
          type: 'object',
          additionalProperties: true,
        },
        returnType: {
          type: 'string',
          enum: [...COMPUTE_RETURN_TYPES],
        },
      },
      required: ['op'],
    },
  },
  {
    demoExample: `// Compute a random integer and persist it for later reads.
rollDice = Mutation("write_computed_state", {
  path: "app.roll",
  op: "random_int",
  options: { min: 1, max: 6 },
  returnType: "number"
})
rollValue = Query("read_state", { path: "app.roll" }, null)

Button("roll-dice", "Roll", "default", Action([@Run(rollDice), @Run(rollValue)]), false)
Text(rollValue == null ? "No roll yet." : "Rolled: " + rollValue, "body", "start")`,
    documentation: {
      summary: 'Computes a safe primitive value, writes it into persisted state at a validated path, and returns `{ value }`.',
      useWhen: 'Use this when a button or action should compute a new primitive result such as a random roll and keep it in persisted browser data.',
      returns: 'Returns `{ value }`, and also writes that same primitive value into the target persisted state path.',
    },
    name: 'write_computed_state',
    shortDescription: 'Compute and persist',
    signature: 'write_computed_state(path, op, input?, left?, right?, values?, options?, returnType?)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        op: {
          type: 'string',
          enum: [...COMPUTE_OPS],
        },
        input: {},
        left: {},
        right: {},
        values: {
          type: 'array',
          items: {},
        },
        options: {
          type: 'object',
          additionalProperties: true,
        },
        returnType: {
          type: 'string',
          enum: [...COMPUTE_RETURN_TYPES],
        },
      },
      required: ['path', 'op'],
    },
  },
  {
    demoExample: `// Write the current input value into persisted state.
savedName = Query("read_state", { path: "app.name" }, "")
saveName = Mutation("write_state", {
  path: "app.name",
  value: $name
})

// Run the mutation, then refresh the visible query.
Button("save-name", "Save", "default", Action([@Run(saveName), @Run(savedName)]), false)`,
    documentation: {
      summary: 'Replaces the value at a non-empty state path with the JSON-compatible value you provide.',
      useWhen: 'Use this for direct assignments, form saves, toggles, or resets when you already know the full next value.',
      returns: 'Returns the value that was written at the target path.',
    },
    name: 'write_state',
    shortDescription: 'Write value',
    signature: 'write_state(path, value)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        value: {},
      },
      required: ['path', 'value'],
    },
  },
  {
    demoExample: `// Patch only the fields you want to change.
savedProfile = Query("read_state", { path: "app.profile" }, { name: "" })
updateProfile = Mutation("merge_state", {
  path: "app.profile",
  patch: { name: $name }
})

// Apply the partial update, then refresh the visible query.
Button("update-profile", "Update profile", "default", Action([@Run(updateProfile), @Run(savedProfile)]), false)`,
    documentation: {
      summary: 'Merges a plain-object patch into the existing object at a non-empty state path.',
      useWhen: 'Use this when you want to update a few fields without overwriting the entire record. The patch must be a plain object with safe keys only.',
      returns: 'Returns the merged object now stored at the target path.',
    },
    name: 'merge_state',
    shortDescription: 'Patch object',
    signature: 'merge_state(path, patch)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        patch: {
          type: 'object',
          additionalProperties: true,
        },
      },
      required: ['path', 'patch'],
    },
  },
  {
    demoExample: `// Add a new item to a persisted array.
tasks = Query("read_state", { path: "app.tasks" }, [])
addTask = Mutation("append_state", {
  path: "app.tasks",
  value: { title: $taskTitle, completed: false }
})

// Append the item, then refresh the visible query.
Button("add-task", "Add task", "default", Action([@Run(addTask), @Run(tasks)]), false)`,
    documentation: {
      summary: 'Appends a new item to the array stored at a non-empty state path.',
      useWhen:
        'Use this for generic arrays, including primitive arrays or object arrays that do not need stable generated ids. Use `append_item` when the array stores plain-object rows that will need id-based row actions later.',
      returns: 'Returns the updated array value after the new item is appended.',
    },
    name: 'append_state',
    shortDescription: 'Append item',
    signature: 'append_state(path, value)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        value: {},
      },
      required: ['path', 'value'],
    },
  },
  {
    demoExample: `// Append a plain-object row and ensure it has a stable id.
tasks = Query("read_state", { path: "app.tasks" }, [])
addTask = Mutation("append_item", {
  path: "app.tasks",
  value: { title: $taskTitle, completed: false }
})

// Append the item, then refresh the visible query.
Button("add-task", "Add", "default", Action([@Run(addTask), @Run(tasks), @Reset($taskTitle)]), $taskTitle == "")`,
    documentation: {
      summary: 'Appends one plain-object item to the array at a validated path and guarantees the appended row has an `id`.',
      useWhen:
        'Use this for persisted collections of object rows such as todos, cards, answers, or records that will need stable row actions later. If `value.id` is missing, the tool generates one automatically.',
      returns: 'Returns the updated array value after the object row is appended.',
    },
    name: 'append_item',
    shortDescription: 'Append object row',
    signature: 'append_item(path, value)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        value: {
          type: 'object',
          additionalProperties: true,
          description: 'Plain object row to append. The tool keeps a provided string/number `id` or generates one when missing.',
        },
      },
      required: ['path', 'value'],
    },
  },
  {
    demoExample: `// Relay the current row id through local state, then toggle a persisted boolean field.
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
    documentation: {
      summary: 'Finds one object row inside a persisted array by id and toggles the target field with safe key validation.',
      useWhen:
        'Use this for booleans such as `completed`, `done`, `selected`, or `archived` on persisted object rows. Keep the Mutation top-level and relay the current row id through local state inside the row action.',
      returns: 'Returns the updated array value after the matched row field is toggled.',
    },
    name: 'toggle_item_field',
    shortDescription: 'Toggle row field',
    signature: 'toggle_item_field(path, idField, id, field)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        idField: {
          type: 'string',
          description: 'Safe object field name used to match the target row, such as `id`.',
        },
        id: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: 'Item id to match against `idField`.',
        },
        field: {
          type: 'string',
          description: 'Safe object field name to toggle, such as `completed`.',
        },
      },
      required: ['path', 'idField', 'id', 'field'],
    },
  },
  {
    demoExample: `// Update one field on a persisted row matched by id.
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
    documentation: {
      summary: 'Finds one object row inside a persisted array by id and replaces one safe field with a JSON-compatible value.',
      useWhen:
        'Use this for direct row edits such as renaming a task, changing a note, updating a status string, or writing a new scalar/object field value onto one matched item.',
      returns: 'Returns the updated array value after the matched row field is replaced.',
    },
    name: 'update_item_field',
    shortDescription: 'Update row field',
    signature: 'update_item_field(path, idField, id, field, value)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        idField: {
          type: 'string',
          description: 'Safe object field name used to match the target row, such as `id`.',
        },
        id: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: 'Item id to match against `idField`.',
        },
        field: {
          type: 'string',
          description: 'Safe object field name to replace on the matched row.',
        },
        value: {
          description: 'JSON-compatible replacement value for the target field.',
        },
      },
      required: ['path', 'idField', 'id', 'field', 'value'],
    },
  },
  {
    demoExample: `// Remove one persisted row by id instead of by array index.
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
    documentation: {
      summary: 'Removes one object row from a persisted array by matching `idField` against the provided `id`.',
      useWhen:
        'Use this for id-based row deletion when the array stores object rows and index-based removal would be fragile or unclear.',
      returns: 'Returns the updated array value after the matched row is removed.',
    },
    name: 'remove_item',
    shortDescription: 'Remove row by id',
    signature: 'remove_item(path, idField, id)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        idField: {
          type: 'string',
          description: 'Safe object field name used to match the target row, such as `id`.',
        },
        id: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: 'Item id to match against `idField`.',
        },
      },
      required: ['path', 'idField', 'id'],
    },
  },
  {
    demoExample: `// Remove one item from a persisted array.
tasks = Query("read_state", { path: "app.tasks" }, [])
removeFirstTask = Mutation("remove_state", {
  path: "app.tasks",
  index: 0
})

// Delete the first item, then refresh the visible query.
Button("remove-first", "Remove first", "destructive", Action([@Run(removeFirstTask), @Run(tasks)]), false)`,
    documentation: {
      summary: 'Removes an item from the array at the given non-empty state path and non-negative index.',
      useWhen: 'Use this to delete list entries without rebuilding the full array manually. The target path must resolve to an existing array.',
      returns: 'Returns the updated array value after removal.',
    },
    name: 'remove_state',
    shortDescription: 'Remove item',
    signature: 'remove_state(path, index)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
        },
        index: {
          type: 'integer',
          minimum: 0,
        },
      },
      required: ['path', 'index'],
    },
  },
];
