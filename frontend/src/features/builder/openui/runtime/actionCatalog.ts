interface OpenUiActionDefinition {
  inputSchema: Record<string, unknown>;
  name: string;
  signature: string;
}

export const OPENUI_ACTION_DEFINITIONS: OpenUiActionDefinition[] = [
  {
    name: 'read_state',
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
    name: 'write_state',
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
    name: 'merge_state',
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
    name: 'append_state',
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
    name: 'remove_state',
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
    name: 'open_url',
    signature: 'open_url(url)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          format: 'uri',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'navigate_screen',
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
