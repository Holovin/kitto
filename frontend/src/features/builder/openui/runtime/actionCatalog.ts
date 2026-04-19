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
    demoExample: `// Write the current input value into persisted state.
saveName = Mutation("write_state", {
  path: "app.name",
  value: $name
})

// Run the mutation from a button.
Button("save-name", "Save", "default", Action([@Run(saveName)]), false)`,
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
updateProfile = Mutation("merge_state", {
  path: "app.profile",
  patch: { name: $name }
})

// Apply the partial update from a button.
Button("update-profile", "Update profile", "default", Action([@Run(updateProfile)]), false)`,
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
addTask = Mutation("append_state", {
  path: "app.tasks",
  value: { title: $taskTitle, completed: false }
})

// Append the item on click.
Button("add-task", "Add task", "default", Action([@Run(addTask)]), false)`,
    documentation: {
      summary: 'Appends a new item to the array stored at a non-empty state path.',
      useWhen: 'Use this for list-style data such as todos, cart items, messages, or comments. The path must already point at an array or an empty slot where an array can be created.',
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
    demoExample: `// Remove one item from a persisted array.
removeFirstTask = Mutation("remove_state", {
  path: "app.tasks",
  index: 0
})

// Delete the first item on click.
Button("remove-first", "Remove first", "destructive", Action([@Run(removeFirstTask)]), false)`,
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
