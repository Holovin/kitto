import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { PromptSpec } from '@openuidev/lang-core';

const componentSpecUrl = new URL(import.meta.resolve('@kitto-openui/shared/openui-component-spec.json'));
const componentSpecSource = fs.readFileSync(componentSpecUrl, 'utf8');

export const openUiComponentSpec = JSON.parse(componentSpecSource) as PromptSpec;
export const openUiComponentSpecHash = createHash('sha256').update(componentSpecSource).digest('hex').slice(0, 12);

export function getOpenUiComponentSignature(componentName: string) {
  const signature = openUiComponentSpec.components[componentName]?.signature;

  if (!signature) {
    throw new Error(`OpenUI component signature not found for "${componentName}".`);
  }

  return signature;
}

function splitTopLevelParameters(parametersSource: string) {
  const parameters: string[] = [];
  let currentParameter = '';
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < parametersSource.length; index += 1) {
    const character = parametersSource[index] ?? '';
    const previousCharacter = parametersSource[index - 1];

    if (quote) {
      currentParameter += character;

      if (character === quote && previousCharacter !== '\\') {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      currentParameter += character;
      continue;
    }

    if (character === '{' || character === '[' || character === '(' || character === '<') {
      depth += 1;
      currentParameter += character;
      continue;
    }

    if (character === '}' || character === ']' || character === ')' || character === '>') {
      depth = Math.max(0, depth - 1);
      currentParameter += character;
      continue;
    }

    if (character === ',' && depth === 0) {
      parameters.push(currentParameter.trim());
      currentParameter = '';
      continue;
    }

    currentParameter += character;
  }

  if (currentParameter.trim()) {
    parameters.push(currentParameter.trim());
  }

  return parameters;
}

function compactSignature(signature: string) {
  const openParenIndex = signature.indexOf('(');
  const closeParenIndex = signature.lastIndexOf(')');

  if (openParenIndex === -1 || closeParenIndex === -1 || closeParenIndex < openParenIndex) {
    return signature;
  }

  const componentName = signature.slice(0, openParenIndex);
  const parametersSource = signature.slice(openParenIndex + 1, closeParenIndex);
  const parameters = splitTopLevelParameters(parametersSource).map((parameter) => parameter.split(':', 1)[0]?.trim() ?? parameter);

  return `${componentName}(${parameters.join(', ')})`;
}

export function getOpenUiComponentCompactSignature(componentName: string) {
  return compactSignature(getOpenUiComponentSignature(componentName));
}

export function buildOpenUiComponentSignatureRule(componentName: string) {
  return `${componentName} signature is \`${getOpenUiComponentCompactSignature(componentName)}\`.`;
}
