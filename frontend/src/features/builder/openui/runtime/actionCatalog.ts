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
      summary: 'Reads the current persisted value stored at the requested state path.',
      useWhen: 'Use this when a component needs to inspect domain data before rendering or before deciding the next action.',
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
Button("Save", "default", Action([@Run(saveName)]), false)`,
    documentation: {
      summary: 'Replaces the value at a state path with the value you provide.',
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
Button("Update profile", "default", Action([@Run(updateProfile)]), false)`,
    documentation: {
      summary: 'Merges a partial object patch into the existing object at a state path.',
      useWhen: 'Use this when you want to update a few fields without overwriting the entire record.',
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
Button("Add task", "default", Action([@Run(addTask)]), false)`,
    documentation: {
      summary: 'Appends a new item to the array stored at a state path.',
      useWhen: 'Use this for list-style data such as todos, cart items, messages, or comments.',
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
Button("Remove first", "ghost", Action([@Run(removeFirstTask)]), false)`,
    documentation: {
      summary: 'Removes an item from the array at the given index.',
      useWhen: 'Use this to delete list entries without rebuilding the full array manually.',
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
        },
        index: {
          type: 'integer',
          minimum: 0,
        },
      },
      required: ['path', 'index'],
    },
  },
  {
    demoExample: `// Create a navigation action for another screen.
goDetails = Mutation("navigate_screen", {
  screenId: "details"
})

// Move to the next screen.
Button("Continue", "default", Action([@Run(goDetails)]), false)`,
    documentation: {
      summary: 'Switches the preview to another screen in the current OpenUI app.',
      useWhen: 'Use this for internal navigation flows such as moving from a list screen to a detail or confirmation screen.',
      returns: 'Returns the screen id that navigation attempted to activate.',
    },
    name: 'navigate_screen',
    shortDescription: 'Switch screen',
    signature: 'navigate_screen(screenId)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        screenId: {
          type: 'string',
        },
      },
      required: ['screenId'],
    },
  },
];
