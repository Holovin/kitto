import { OPENUI_TOOL_REGISTRY } from '@kitto-openui/shared/openuiToolRegistry.js';
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

const OPENUI_ACTION_DEFINITION_SEEDS: OpenUiActionDefinitionSeed[] = OPENUI_TOOL_REGISTRY.map((tool) => ({
  inputSchema: tool.actionInputSchema,
  name: tool.name,
  shortDescription: tool.shortDescription,
  signature: tool.signature,
}));

export const OPENUI_ACTION_DEFINITIONS: OpenUiActionDefinition[] = OPENUI_ACTION_DEFINITION_SEEDS.map((definition) => ({
  ...definition,
  demoExample: getRequiredActionDemoExample(definition.name),
  documentation: getRequiredActionDocumentation(definition.name),
}));
