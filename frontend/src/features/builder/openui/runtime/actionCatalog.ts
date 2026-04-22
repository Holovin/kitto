import { COMPUTE_OPS, COMPUTE_RETURN_TYPES } from './computeTools';
import { OPENUI_ACTION_DEMO_EXAMPLES } from './actionDemos';
import { OPENUI_ACTION_DOCUMENTATION, type OpenUiActionDocumentation } from './actionDocs';

export interface OpenUiActionDefinition {
  demoExample: string;
  documentation: OpenUiActionDocumentation;
  inputSchema: Record<string, unknown>;
  name: string;
  shortDescription: string;
  signature: string;
}

type OpenUiActionDefinitionSeed = Omit<OpenUiActionDefinition, 'demoExample' | 'documentation'>;

function getRequiredActionDemoExample(actionName: string) {
  const demoExample = OPENUI_ACTION_DEMO_EXAMPLES[actionName];

  if (!demoExample) {
    throw new Error(`Missing demoExample for OpenUI action "${actionName}".`);
  }

  return demoExample;
}

function getRequiredActionDocumentation(actionName: string) {
  const documentation = OPENUI_ACTION_DOCUMENTATION[actionName];

  if (!documentation) {
    throw new Error(`Missing documentation for OpenUI action "${actionName}".`);
  }

  return documentation;
}

const OPENUI_ACTION_DEFINITION_SEEDS: OpenUiActionDefinitionSeed[] = [
  {
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
          description:
            'Plain object row to append. The tool keeps a provided non-empty string or finite number `id`; otherwise it generates one automatically.',
        },
      },
      required: ['path', 'value'],
    },
  },
  {
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

export const OPENUI_ACTION_DEFINITIONS: OpenUiActionDefinition[] = OPENUI_ACTION_DEFINITION_SEEDS.map((definition) => ({
  ...definition,
  demoExample: getRequiredActionDemoExample(definition.name),
  documentation: getRequiredActionDocumentation(definition.name),
}));
