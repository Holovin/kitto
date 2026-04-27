export const OPENUI_COMPUTE_OPS = [
  'truthy',
  'falsy',
  'not',
  'and',
  'or',
  'equals',
  'not_equals',
  'number_gt',
  'number_gte',
  'number_lt',
  'number_lte',
  'is_empty',
  'not_empty',
  'contains_text',
  'starts_with',
  'ends_with',
  'to_lower',
  'to_upper',
  'trim',
  'to_number',
  'add',
  'subtract',
  'multiply',
  'divide',
  'clamp',
  'random_int',
  'today_date',
  'date_before',
  'date_after',
  'date_on_or_before',
  'date_on_or_after',
] as const;

export const OPENUI_COMPUTE_RETURN_TYPES = ['string', 'number', 'boolean'] as const;

export type OpenUiComputeOp = (typeof OPENUI_COMPUTE_OPS)[number];
export type OpenUiComputeReturnType = (typeof OPENUI_COMPUTE_RETURN_TYPES)[number];

type OpenUiJsonSchema = Record<string, unknown>;

interface OpenUiPromptToolSpec {
  annotations?: Record<string, unknown>;
  description: string;
  inputSchema: OpenUiJsonSchema;
  name: string;
  outputSchema: OpenUiJsonSchema;
}

interface OpenUiToolRegistryEntry {
  actionInputSchema: OpenUiJsonSchema;
  annotations?: Record<string, unknown>;
  description: string;
  name: string;
  outputSchema: OpenUiJsonSchema;
  promptInputSchema: OpenUiJsonSchema;
  shortDescription: string;
  signature: string;
}

const pathActionProperty = {
  type: 'string',
  description:
    'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Avoid `__proto__`, `prototype`, and `constructor`.',
} as const satisfies OpenUiJsonSchema;

const pathPromptProperty = {
  type: 'string',
  description:
    'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
} as const satisfies OpenUiJsonSchema;

const readStatePathPromptProperty = {
  type: 'string',
  description:
    'Non-empty dot-path such as app.tasks or app.profile.name. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
} as const satisfies OpenUiJsonSchema;

const idFieldProperty = {
  type: 'string',
  description: 'Safe object field name used to match the target row, such as `id`.',
} as const satisfies OpenUiJsonSchema;

const idProperty = {
  oneOf: [{ type: 'string' }, { type: 'number' }],
  description: 'Item id to match against `idField`.',
} as const satisfies OpenUiJsonSchema;

const computeActionProperties = {
  op: {
    type: 'string',
    enum: [...OPENUI_COMPUTE_OPS],
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
    enum: [...OPENUI_COMPUTE_RETURN_TYPES],
  },
} as const satisfies Record<string, OpenUiJsonSchema>;

const openUiComputeToolSharedProperties = {
  input: {
    description: 'Primary input value for unary operations.',
  },
  left: {
    description: 'Left-hand operand for binary comparisons or math.',
  },
  right: {
    description: 'Right-hand operand for binary comparisons or math.',
  },
  values: {
    type: 'array',
    items: {},
    description: 'Array of values for variadic boolean operations such as `and` or `or`.',
  },
  options: {
    type: 'object',
    additionalProperties: true,
    description:
      'Plain-object options. Use `options.query` for string checks, `options.min`/`options.max` for clamp or random_int, and only YYYY-MM-DD strings for date comparisons.',
  },
  returnType: {
    type: 'string',
    enum: [...OPENUI_COMPUTE_RETURN_TYPES],
    description: 'Optional output type normalization. Output must stay a primitive string, number, or boolean.',
  },
} as const satisfies Record<string, OpenUiJsonSchema>;

const computePromptProperties = {
  op: {
    type: 'string',
    enum: [...OPENUI_COMPUTE_OPS],
    description:
      'Allowed operations only. Prefer OpenUI built-ins and normal expressions first; use this when those do not cover the requested logic cleanly.',
  },
  ...openUiComputeToolSharedProperties,
} as const satisfies Record<string, OpenUiJsonSchema>;

function actionObjectSchema(properties: Record<string, unknown>, required: string[]): OpenUiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

function promptObjectSchema(properties: Record<string, unknown>, required: string[]): OpenUiJsonSchema {
  return {
    type: 'object',
    properties,
    required,
  };
}

export const OPENUI_TOOL_REGISTRY = [
  {
    name: 'read_state',
    shortDescription: 'Read stored value',
    signature: 'read_state(path)',
    description: 'Read a value from the persisted browser data tree at a non-empty dot-path.',
    actionInputSchema: actionObjectSchema({ path: pathActionProperty }, ['path']),
    promptInputSchema: promptObjectSchema({ path: readStatePathPromptProperty }, ['path']),
    outputSchema: {
      description: 'The value currently stored at the path, or null when the path is missing.',
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: 'compute_value',
    shortDescription: 'Compute primitive value',
    signature: 'compute_value(op, input?, left?, right?, values?, options?, returnType?)',
    description:
      'Run an opt-in safe primitive-only computation for booleans, comparisons, strings, numbers, dates, and random integers. Do not use it for simple CRUD/list apps, basic screen navigation, filtering, or normal input display. Do not use it for button-triggered roll-on-click randomness; use `write_computed_state` plus `Query("read_state", ...)` instead. Returns an object shaped like `{ value }`.',
    actionInputSchema: actionObjectSchema(computeActionProperties, ['op']),
    promptInputSchema: promptObjectSchema(computePromptProperties, ['op']),
    outputSchema: {
      description: 'An object shaped like `{ value }`, where `value` is always a primitive string, number, or boolean.',
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: 'write_computed_state',
    shortDescription: 'Compute and persist',
    signature: 'write_computed_state(path, op, input?, left?, right?, values?, options?, returnType?)',
    description:
      'Compute an opt-in safe primitive value, write it to a validated persisted state path, and return an object shaped like `{ value }`. Use it for button-triggered computed values such as random rolls that should persist for later rendering. After the action, re-read the visible value with `Query("read_state", ...)` instead of rendering the Mutation ref directly.',
    actionInputSchema: actionObjectSchema({ path: pathActionProperty, ...computeActionProperties }, ['path', 'op']),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        op: {
          type: 'string',
          enum: [...OPENUI_COMPUTE_OPS],
          description: 'Allowed compute operation name.',
        },
        ...openUiComputeToolSharedProperties,
      },
      ['path', 'op'],
    ),
    outputSchema: {
      description: 'An object shaped like `{ value }`, and the same primitive value is written at the requested path.',
    },
  },
  {
    name: 'write_state',
    shortDescription: 'Write value',
    signature: 'write_state(path, value)',
    description: 'Replace the persisted value at a non-empty dot-path.',
    actionInputSchema: actionObjectSchema({ path: pathActionProperty, value: {} }, ['path', 'value']),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        value: { description: 'Any JSON-compatible value.' },
      },
      ['path', 'value'],
    ),
    outputSchema: {
      description: 'The value that is now stored at the path.',
    },
  },
  {
    name: 'merge_state',
    shortDescription: 'Patch object',
    signature: 'merge_state(path, patch)',
    description: 'Shallow-merge a plain-object patch into the persisted value at a non-empty dot-path.',
    actionInputSchema: actionObjectSchema(
      {
        path: pathActionProperty,
        patch: {
          type: 'object',
          additionalProperties: true,
        },
      },
      ['path', 'patch'],
    ),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        patch: { type: 'object', additionalProperties: true },
      },
      ['path', 'patch'],
    ),
    outputSchema: {
      description: 'The merged object stored at the path.',
    },
  },
  {
    name: 'append_state',
    shortDescription: 'Append item',
    signature: 'append_state(path, value)',
    description:
      'Append a JSON-compatible value to an array stored at a non-empty dot-path. Prefer `append_item` when the array stores plain-object rows that need stable ids for later row actions.',
    actionInputSchema: actionObjectSchema({ path: pathActionProperty, value: {} }, ['path', 'value']),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        value: { description: 'The JSON-compatible value to append.' },
      },
      ['path', 'value'],
    ),
    outputSchema: {
      description: 'The updated array stored at the path.',
    },
  },
  {
    name: 'append_item',
    shortDescription: 'Append object row',
    signature: 'append_item(path, value)',
    description:
      'Append one plain-object row to an array stored at a non-empty dot-path. Keeps a provided unique non-empty string or finite number `id`; otherwise generates a stable unique `id`.',
    actionInputSchema: actionObjectSchema(
      {
        path: pathActionProperty,
        value: {
          type: 'object',
          additionalProperties: true,
          description:
            'Plain object row to append. The tool keeps a provided unique non-empty string or finite number `id`; otherwise it generates one automatically.',
        },
      },
      ['path', 'value'],
    ),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        value: {
          type: 'object',
          additionalProperties: true,
          description: 'Plain object row to append.',
        },
      },
      ['path', 'value'],
    ),
    outputSchema: {
      description: 'The updated array stored at the path, including the appended row with a unique stable `id`.',
    },
  },
  {
    name: 'toggle_item_field',
    shortDescription: 'Toggle row field',
    signature: 'toggle_item_field(path, idField, id, field)',
    description:
      'Find one plain-object row inside an array by id and toggle one safe field. Use it for booleans such as completed, done, selected, or archived.',
    actionInputSchema: actionObjectSchema(
      {
        path: pathActionProperty,
        idField: idFieldProperty,
        id: idProperty,
        field: {
          type: 'string',
          description: 'Safe object field name to toggle, such as `completed`.',
        },
      },
      ['path', 'idField', 'id', 'field'],
    ),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        idField: idFieldProperty,
        id: idProperty,
        field: {
          type: 'string',
          description: 'Safe object field name to toggle, such as `completed`.',
        },
      },
      ['path', 'idField', 'id', 'field'],
    ),
    outputSchema: {
      description: 'The updated array stored at the path after the matched row field is toggled.',
    },
  },
  {
    name: 'update_item_field',
    shortDescription: 'Update row field',
    signature: 'update_item_field(path, idField, id, field, value)',
    description:
      'Find one plain-object row inside an array by id and replace one safe field with a JSON-compatible value.',
    actionInputSchema: actionObjectSchema(
      {
        path: pathActionProperty,
        idField: idFieldProperty,
        id: idProperty,
        field: {
          type: 'string',
          description: 'Safe object field name to replace on the matched row.',
        },
        value: {
          description: 'JSON-compatible replacement value for the target field.',
        },
      },
      ['path', 'idField', 'id', 'field', 'value'],
    ),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        idField: idFieldProperty,
        id: idProperty,
        field: {
          type: 'string',
          description: 'Safe object field name to replace on the matched row.',
        },
        value: {
          description: 'JSON-compatible replacement value for the target field.',
        },
      },
      ['path', 'idField', 'id', 'field', 'value'],
    ),
    outputSchema: {
      description: 'The updated array stored at the path after the matched row field is replaced.',
    },
  },
  {
    name: 'remove_item',
    shortDescription: 'Remove row by id',
    signature: 'remove_item(path, idField, id)',
    description:
      'Remove one plain-object row from an array by matching an item id field. Prefer it over index-based deletion when the collection stores object rows.',
    actionInputSchema: actionObjectSchema(
      {
        path: pathActionProperty,
        idField: idFieldProperty,
        id: idProperty,
      },
      ['path', 'idField', 'id'],
    ),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        idField: idFieldProperty,
        id: idProperty,
      },
      ['path', 'idField', 'id'],
    ),
    outputSchema: {
      description: 'The updated array stored at the path after the matched row is removed.',
    },
  },
  {
    name: 'remove_state',
    shortDescription: 'Remove item',
    signature: 'remove_state(path, index)',
    description: 'Remove an array item by non-negative index from the persisted value at a non-empty dot-path.',
    actionInputSchema: actionObjectSchema(
      {
        path: pathActionProperty,
        index: {
          type: 'integer',
          minimum: 0,
        },
      },
      ['path', 'index'],
    ),
    promptInputSchema: promptObjectSchema(
      {
        path: pathPromptProperty,
        index: { type: 'integer', minimum: 0 },
      },
      ['path', 'index'],
    ),
    outputSchema: {
      description: 'The updated array stored at the path.',
    },
  },
] as const satisfies readonly OpenUiToolRegistryEntry[];

type OpenUiToolName = (typeof OPENUI_TOOL_REGISTRY)[number]['name'];

export const OPENUI_TOOL_NAMES = OPENUI_TOOL_REGISTRY.map((tool) => tool.name) as OpenUiToolName[];

const OPENUI_PROMPT_TOOL_ORDER = [
  'read_state',
  'compute_value',
  'write_state',
  'merge_state',
  'append_state',
  'append_item',
  'toggle_item_field',
  'update_item_field',
  'remove_item',
  'write_computed_state',
  'remove_state',
] as const satisfies readonly OpenUiToolName[];

const OPENUI_TOOL_BY_NAME = new Map<string, OpenUiToolRegistryEntry>(
  OPENUI_TOOL_REGISTRY.map((tool) => [tool.name, tool]),
);

export function getOpenUiPromptToolSpecs(): OpenUiPromptToolSpec[] {
  return OPENUI_PROMPT_TOOL_ORDER.map((toolName) => {
    const tool = OPENUI_TOOL_BY_NAME.get(toolName);

    if (!tool) {
      throw new Error(`Missing OpenUI tool registry entry for "${toolName}".`);
    }

    return {
      annotations: tool.annotations,
      description: tool.description,
      inputSchema: tool.promptInputSchema,
      name: tool.name,
      outputSchema: tool.outputSchema,
    };
  });
}
