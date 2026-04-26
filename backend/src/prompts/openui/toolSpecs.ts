import type { ToolSpec } from '@openuidev/lang-core';
import {
  getOpenUiPromptToolSpecs,
  openUiComputeToolSharedProperties,
  OPENUI_COMPUTE_OPS,
} from '@kitto-openui/shared/openuiToolRegistry.js';

export interface PromptToolSpecSummary {
  description: string;
  name: string;
  signature: string;
}

export const computeOperationEnum = OPENUI_COMPUTE_OPS;
export const computeToolSharedProperties = openUiComputeToolSharedProperties;

export const toolSpecifications: ToolSpec[] = getOpenUiPromptToolSpecs().map((toolSpecification) => {
  const toolSpec: ToolSpec = {
    description: toolSpecification.description,
    inputSchema: toolSpecification.inputSchema,
    name: toolSpecification.name,
    outputSchema: toolSpecification.outputSchema,
  };

  if (toolSpecification.annotations) {
    toolSpec.annotations = toolSpecification.annotations;
  }

  return toolSpec;
});

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
