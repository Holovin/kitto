import type { ToolSpec } from '@openuidev/lang-core';

export interface PromptToolSpecSummary {
  description: string;
  name: string;
  signature: string;
}

export const computeOperationEnum = [
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

const computeReturnTypeEnum = ['string', 'number', 'boolean'] as const;

export const computeToolSharedProperties = {
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
    enum: [...computeReturnTypeEnum],
    description: 'Optional output type normalization. Output must stay a primitive string, number, or boolean.',
  },
} as const;

export const toolSpecifications: ToolSpec[] = [
  {
    name: 'read_state',
    description: 'Read a value from the persisted browser data tree at a non-empty dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path such as app.tasks or app.profile.name. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
        },
      },
      required: ['path'],
    },
    outputSchema: {
      description: 'The value currently stored at the path, or null when the path is missing.',
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: 'compute_value',
    description:
      'Run an opt-in safe primitive-only computation for booleans, comparisons, strings, numbers, dates, and random integers. Do not use it for simple CRUD/list apps, basic screen navigation, filtering, or normal input display. Do not use it for button-triggered roll-on-click randomness; use `write_computed_state` plus `Query("read_state", ...)` instead. Returns an object shaped like `{ value }`.',
    inputSchema: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: [...computeOperationEnum],
          description:
            'Allowed operations only. Prefer OpenUI built-ins and normal expressions first; use this when those do not cover the requested logic cleanly.',
        },
        ...computeToolSharedProperties,
      },
      required: ['op'],
    },
    outputSchema: {
      description: 'An object shaped like `{ value }`, where `value` is always a primitive string, number, or boolean.',
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: 'write_state',
    description: 'Replace the persisted value at a non-empty dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
        },
        value: { description: 'Any JSON-compatible value.' },
      },
      required: ['path', 'value'],
    },
    outputSchema: {
      description: 'The value that is now stored at the path.',
    },
  },
  {
    name: 'merge_state',
    description: 'Shallow-merge a plain-object patch into the persisted value at a non-empty dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
        },
        patch: { type: 'object', additionalProperties: true },
      },
      required: ['path', 'patch'],
    },
    outputSchema: {
      description: 'The merged object stored at the path.',
    },
  },
  {
    name: 'append_state',
    description:
      'Append a JSON-compatible value to an array stored at a non-empty dot-path. Prefer `append_item` when the array stores plain-object rows that need stable ids for later row actions.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
        },
        value: { description: 'The JSON-compatible value to append.' },
      },
      required: ['path', 'value'],
    },
    outputSchema: {
      description: 'The updated array stored at the path.',
    },
  },
  {
    name: 'append_item',
    description:
      'Append one plain-object row to an array stored at a non-empty dot-path. Keeps a provided non-empty string or finite number `id`; otherwise generates a stable `id`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
        },
        value: {
          type: 'object',
          additionalProperties: true,
          description: 'Plain object row to append.',
        },
      },
      required: ['path', 'value'],
    },
    outputSchema: {
      description: 'The updated array stored at the path, including the appended row with a stable `id`.',
    },
  },
  {
    name: 'toggle_item_field',
    description:
      'Find one plain-object row inside an array by id and toggle one safe field. Use it for booleans such as completed, done, selected, or archived.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
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
    outputSchema: {
      description: 'The updated array stored at the path after the matched row field is toggled.',
    },
  },
  {
    name: 'update_item_field',
    description:
      'Find one plain-object row inside an array by id and replace one safe field with a JSON-compatible value.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
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
    outputSchema: {
      description: 'The updated array stored at the path after the matched row field is replaced.',
    },
  },
  {
    name: 'remove_item',
    description:
      'Remove one plain-object row from an array by matching an item id field. Prefer it over index-based deletion when the collection stores object rows.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
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
    outputSchema: {
      description: 'The updated array stored at the path after the matched row is removed.',
    },
  },
  {
    name: 'write_computed_state',
    description:
      'Compute an opt-in safe primitive value, write it to a validated persisted state path, and return an object shaped like `{ value }`. Use it for button-triggered computed values such as random rolls that should persist for later rendering. After the action, re-read the visible value with `Query("read_state", ...)` instead of rendering the Mutation ref directly.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
        },
        op: {
          type: 'string',
          enum: [...computeOperationEnum],
          description: 'Allowed compute operation name.',
        },
        ...computeToolSharedProperties,
      },
      required: ['path', 'op'],
    },
    outputSchema: {
      description: 'An object shaped like `{ value }`, and the same primitive value is written at the requested path.',
    },
  },
  {
    name: 'remove_state',
    description: 'Remove an array item by non-negative index from the persisted value at a non-empty dot-path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Non-empty dot-path. Segments may use letters, numbers, `_`, or `-`. Never use __proto__, prototype, or constructor.',
        },
        index: { type: 'integer', minimum: 0 },
      },
      required: ['path', 'index'],
    },
    outputSchema: {
      description: 'The updated array stored at the path.',
    },
  },
];

function buildToolSignature(toolSpecification: ToolSpec) {
  const inputSchema = toolSpecification.inputSchema;

  if (!inputSchema || typeof inputSchema !== 'object' || !('properties' in inputSchema)) {
    return `${toolSpecification.name}()`;
  }

  const properties = inputSchema.properties;

  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return `${toolSpecification.name}()`;
  }

  const requiredProperties = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
  const propertyNames = Object.keys(properties);

  if (propertyNames.length === 0) {
    return `${toolSpecification.name}()`;
  }

  return `${toolSpecification.name}(${propertyNames
    .map((propertyName) => (requiredProperties.has(propertyName) ? propertyName : `${propertyName}?`))
    .join(', ')})`;
}

const promptToolSpecSummaries = Object.freeze(
  toolSpecifications.map<PromptToolSpecSummary>((toolSpecification) => ({
    description: toolSpecification.description ?? '',
    name: toolSpecification.name,
    signature: buildToolSignature(toolSpecification),
  })),
);

export function getPromptToolSpecSummaries() {
  return promptToolSpecSummaries;
}
