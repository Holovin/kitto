import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { generatePrompt, type PromptSpec } from '@openuidev/lang-core';
import { additionalRules } from './rules.js';
import { toolExamples } from './toolExamples.js';
import { toolSpecifications } from './toolSpecs.js';

interface BuildOpenUiPromptOptions {
  structuredOutput?: boolean;
}

type SystemPromptVariant = 'plain' | 'structured';

const componentSpecPath = new URL('../../../../shared/openui-component-spec.json', import.meta.url);
const componentSpecSource = fs.readFileSync(componentSpecPath, 'utf8');
const componentSpecHash = createHash('sha256').update(componentSpecSource).digest('hex').slice(0, 12);
const componentSpec = JSON.parse(componentSpecSource) as PromptSpec;

const preamble =
  'You generate OpenUI Lang for Kitto, a chat-driven browser app builder. Build small frontend-only apps that run entirely in the browser.';

function buildAdditionalRules(options: BuildOpenUiPromptOptions = {}) {
  const structuredOutput = options.structuredOutput ?? true;

  if (structuredOutput) {
    return additionalRules;
  }

  return [
    ...additionalRules.slice(0, 5),
    'Return only raw OpenUI Lang source. Do not wrap it in markdown, prose, or code fences.',
    ...additionalRules.slice(5),
  ];
}

function getSystemPromptVariant(options: BuildOpenUiPromptOptions = {}): SystemPromptVariant {
  return (options.structuredOutput ?? true) ? 'structured' : 'plain';
}

const cachedSystemPrompts = new Map<SystemPromptVariant, string>();
const cachedSystemPromptKeys = new Map<SystemPromptVariant, string>();

export function buildOpenUiSystemPrompt(options: BuildOpenUiPromptOptions = {}) {
  const variant = getSystemPromptVariant(options);
  const cachedPrompt = cachedSystemPrompts.get(variant);

  if (cachedPrompt) {
    return cachedPrompt;
  }

  const prompt = generatePrompt({
    ...componentSpec,
    tools: toolSpecifications,
    toolCalls: true,
    bindings: true,
    editMode: false,
    inlineMode: false,
    preamble,
    toolExamples,
    additionalRules: buildAdditionalRules(options),
  });

  cachedSystemPrompts.set(variant, prompt);
  return prompt;
}

export function getOpenUiSystemPromptCacheKey(options: BuildOpenUiPromptOptions = {}) {
  const variant = getSystemPromptVariant(options);
  const cachedKey = cachedSystemPromptKeys.get(variant);

  if (cachedKey) {
    return cachedKey;
  }

  const promptHash = createHash('sha256').update(buildOpenUiSystemPrompt(options)).digest('hex').slice(0, 16);
  const variantCode = variant === 'structured' ? 'st' : 'pl';
  const cacheKey = `kitto:openui:${variantCode}:${componentSpecHash}:${promptHash}`;

  cachedSystemPromptKeys.set(variant, cacheKey);
  return cacheKey;
}
