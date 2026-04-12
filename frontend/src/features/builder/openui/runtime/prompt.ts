export const OPENUI_SUPPORTED_COMPONENTS = [
  'AppShell',
  'Screen',
  'Group',
  'Repeater',
  'Text',
  'Input',
  'TextArea',
  'Checkbox',
  'RadioGroup',
  'Select',
  'Button',
  'Link',
] as const;

export const OPENUI_SUPPORTED_TOOLS = [
  'read_state(path)',
  'write_state(path, value)',
  'merge_state(path, patch)',
  'append_state(path, value)',
  'remove_state(path, index)',
  'open_url(url)',
  'navigate_screen(screenId)',
] as const;

export const OPENUI_AUTHORING_HINTS = [
  'Root must be AppShell.',
  'Use Screen for screen-level sections and Group for local layout.',
  'Use Repeater with @Each(...) results when rendering collections.',
  'Use Query()/Mutation() only with the supported tool names.',
  'Prefer local $variables for ephemeral UI state and write_state for exportable data.',
] as const;
