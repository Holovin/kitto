export interface OpenUiActionDocumentation {
  returns: string;
  summary: string;
  useWhen: string;
}

export const OPENUI_ACTION_DOCUMENTATION: Record<string, OpenUiActionDocumentation> = {
  read_state: {
    summary: 'Reads the current persisted value stored at the requested non-empty state path.',
    useWhen: 'Use this when a component needs to inspect domain data before rendering or before deciding the next action. Use dot-path segments made of letters, numbers, `_`, or `-` only.',
    returns: 'Returns the value at the requested path, or null when nothing is stored there.',
  },
  compute_value: {
    summary: 'Runs a safe primitive-only calculation and returns an object shaped like `{ value }`.',
    useWhen: 'Use this for simple boolean, number, string, random-int, or date calculations that OpenUI built-ins and normal expressions do not already cover well.',
    returns: 'Returns `{ value }`, where `value` is always a primitive string, number, or boolean.',
  },
  write_computed_state: {
    summary: 'Computes a safe primitive value, writes it into persisted state at a validated path, and returns `{ value }`.',
    useWhen: 'Use this when a button or action should compute a new primitive result such as a random roll and keep it in persisted browser data.',
    returns: 'Returns `{ value }`, and also writes that same primitive value into the target persisted state path.',
  },
  write_state: {
    summary: 'Replaces the value at a non-empty state path with the JSON-compatible value you provide.',
    useWhen: 'Use this for direct assignments, form saves, toggles, or resets when you already know the full next value.',
    returns: 'Returns the value that was written at the target path.',
  },
  merge_state: {
    summary: 'Merges a plain-object patch into the existing object at a non-empty state path.',
    useWhen: 'Use this when you want to update a few fields without overwriting the entire record. The patch must be a plain object with safe keys only.',
    returns: 'Returns the merged object now stored at the target path.',
  },
  append_state: {
    summary: 'Appends a new item to the array stored at a non-empty state path.',
    useWhen:
      'Use this for generic arrays, including primitive arrays or object arrays that do not need stable generated ids. Use `append_item` when the array stores plain-object rows that will need id-based row actions later.',
    returns: 'Returns the updated array value after the new item is appended.',
  },
  append_item: {
    summary: 'Appends one plain-object item to the array at a validated path and guarantees the appended row has an `id`.',
    useWhen:
      'Use this for persisted collections of object rows such as todos, cards, answers, or records that will need stable row actions later. If `value.id` is missing or blank, the tool generates one automatically. When you provide it, keep it a non-empty string or finite number.',
    returns: 'Returns the updated array value after the object row is appended.',
  },
  toggle_item_field: {
    summary: 'Finds one object row inside a persisted array by id and toggles the target field with safe key validation.',
    useWhen:
      'Use this for booleans such as `completed`, `done`, `selected`, or `archived` on persisted object rows. Keep the Mutation top-level and relay the current row id through local state inside the row action.',
    returns: 'Returns the updated array value after the matched row field is toggled.',
  },
  update_item_field: {
    summary: 'Finds one object row inside a persisted array by id and replaces one safe field with a JSON-compatible value.',
    useWhen:
      'Use this for direct row edits such as renaming a task, changing a note, updating a status string, or writing a new scalar/object field value onto one matched item.',
    returns: 'Returns the updated array value after the matched row field is replaced.',
  },
  remove_item: {
    summary: 'Removes one object row from a persisted array by matching `idField` against the provided `id`.',
    useWhen:
      'Use this for id-based row deletion when the array stores object rows and index-based removal would be fragile or unclear.',
    returns: 'Returns the updated array value after the matched row is removed.',
  },
  remove_state: {
    summary: 'Removes an item from the array at the given non-empty state path and non-negative index.',
    useWhen: 'Use this to delete list entries without rebuilding the full array manually. The target path must resolve to an existing array.',
    returns: 'Returns the updated array value after removal.',
  },
};
