import { builderOpenUiLibrary } from '@pages/Chat/builder/openui/library';
import { OPENUI_ACTION_DEFINITIONS } from '@pages/Chat/builder/openui/runtime/actionCatalog';
import { OPENUI_SUPPORTED_COMPONENTS } from '@pages/Chat/builder/openui/runtime/prompt';

export type ReferenceTabId = 'elements' | 'actions' | 'prompts';
export type PromptReferenceSectionLabel =
  | 'Backend config'
  | 'System prompt'
  | 'Intent context'
  | 'User prompt template'
  | 'Tool specs'
  | 'Repair prompt'
  | 'Output envelope schema';

export type ReferenceItem = {
  id: string;
  label: string;
  tab: ReferenceTabId;
};

export type ReferenceGroup = {
  id: string;
  items: ReferenceItem[];
  label: string;
  tab: ReferenceTabId;
};

function collapseReferenceValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function createReferenceAnchorId(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function createReferenceItem(label: string, tab: ReferenceTabId): ReferenceItem {
  return {
    id: createReferenceAnchorId(label),
    label,
    tab,
  };
}

function createReferenceGroup(label: string, tab: ReferenceTabId, items: ReferenceItem[]): ReferenceGroup {
  return {
    id: createReferenceAnchorId(label),
    items,
    label,
    tab,
  };
}

function createReferenceAliases(value: string) {
  const canonicalValue = createReferenceAnchorId(value);

  return new Set(
    [value.trim().toLowerCase(), canonicalValue, collapseReferenceValue(value), collapseReferenceValue(canonicalValue)].filter(Boolean),
  );
}

export const ELEMENT_REFERENCE_ITEMS = OPENUI_SUPPORTED_COMPONENTS.map((componentName) => createReferenceItem(componentName, 'elements'));

export const ACTION_REFERENCE_ITEMS = OPENUI_ACTION_DEFINITIONS.map((action) => createReferenceItem(action.name, 'actions'));

export const PROMPT_REFERENCE_ITEMS: ReferenceItem[] = [
  createReferenceItem('Backend config', 'prompts'),
  createReferenceItem('System prompt', 'prompts'),
  createReferenceItem('Intent context', 'prompts'),
  createReferenceItem('User prompt template', 'prompts'),
  createReferenceItem('Tool specs', 'prompts'),
  createReferenceItem('Repair prompt', 'prompts'),
  createReferenceItem('Output envelope schema', 'prompts'),
];

const elementReferenceItemsByLabel = new Map(ELEMENT_REFERENCE_ITEMS.map((item) => [item.label, item] as const));
const actionReferenceItemsByLabel = new Map(ACTION_REFERENCE_ITEMS.map((item) => [item.label, item] as const));
const promptReferenceItemsByLabel = new Map(PROMPT_REFERENCE_ITEMS.map((item) => [item.label, item] as const));

export const ELEMENT_REFERENCE_GROUPS = (builderOpenUiLibrary.componentGroups ?? []).map((group) =>
  createReferenceGroup(
    group.name,
    'elements',
    group.components.flatMap((componentName) => {
      const item = elementReferenceItemsByLabel.get(componentName);
      return item ? [item] : [];
    }),
  ),
);

const ACTION_GROUP_DEFINITIONS = [
  {
    label: 'Read & Compute',
    items: ['read_state', 'compute_value', 'write_computed_state'],
  },
  {
    label: 'State Paths',
    items: ['write_state', 'merge_state', 'remove_state'],
  },
  {
    label: 'Collections',
    items: ['append_state', 'append_item', 'toggle_item_field', 'update_item_field', 'remove_item'],
  },
] as const;

export const ACTION_REFERENCE_GROUPS = ACTION_GROUP_DEFINITIONS.map((group) =>
  createReferenceGroup(
    group.label,
    'actions',
    group.items.flatMap((actionName) => {
      const item = actionReferenceItemsByLabel.get(actionName);
      return item ? [item] : [];
    }),
  ),
);

const PROMPT_GROUP_DEFINITIONS = [
  {
    label: 'Backend',
    items: ['Backend config', 'System prompt', 'Intent context'],
  },
  {
    label: 'Templates',
    items: ['User prompt template', 'Repair prompt'],
  },
  {
    label: 'Contracts',
    items: ['Tool specs', 'Output envelope schema'],
  },
] as const;

export const PROMPT_REFERENCE_GROUPS = PROMPT_GROUP_DEFINITIONS.map((group) =>
  createReferenceGroup(
    group.label,
    'prompts',
    group.items.flatMap((sectionLabel) => {
      const item = promptReferenceItemsByLabel.get(sectionLabel);
      return item ? [item] : [];
    }),
  ),
);

const referenceLookup = new Map<string, ReferenceItem>();

function registerReferenceItems(items: ReferenceItem[]) {
  items.forEach((item) => {
    createReferenceAliases(item.label).forEach((alias) => {
      referenceLookup.set(alias, item);
    });
    createReferenceAliases(item.id).forEach((alias) => {
      referenceLookup.set(alias, item);
    });
  });
}

registerReferenceItems(ELEMENT_REFERENCE_ITEMS);
registerReferenceItems(ACTION_REFERENCE_ITEMS);
registerReferenceItems(PROMPT_REFERENCE_ITEMS);

export function resolveReferenceTargetFromHash(hash: string): ReferenceItem | null {
  const normalizedHash = hash.replace(/^#/, '').trim();

  if (!normalizedHash) {
    return null;
  }

  return referenceLookup.get(normalizedHash.toLowerCase()) ?? referenceLookup.get(collapseReferenceValue(normalizedHash)) ?? null;
}
