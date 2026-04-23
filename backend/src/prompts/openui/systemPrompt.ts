import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { generatePrompt, type PromptSpec } from '@openuidev/lang-core';
import { buildAdditionalRulesForPrompt } from './rules.js';
import { getPromptIntentCacheVector } from './promptIntents.js';
import { buildToolExamplesForPrompt } from './toolExamples.js';
import { toolSpecifications } from './toolSpecs.js';

interface BuildOpenUiPromptOptions {
  prompt?: string;
}

const componentSpecPath = new URL('../../../../shared/openui-component-spec.json', import.meta.url);
const componentSpecSource = fs.readFileSync(componentSpecPath, 'utf8');
const componentSpecHash = createHash('sha256').update(componentSpecSource).digest('hex').slice(0, 12);
const componentSpec = JSON.parse(componentSpecSource) as PromptSpec;
export const OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX = 'kitto:openui';

const preamble =
  'You generate OpenUI Lang for Kitto, a chat-driven browser app builder. Build small frontend-only apps that run entirely in the browser.';

function buildAdditionalRules(options: BuildOpenUiPromptOptions = {}) {
  return buildAdditionalRulesForPrompt(options.prompt);
}

function buildToolExamples(options: BuildOpenUiPromptOptions = {}) {
  return buildToolExamplesForPrompt(options.prompt);
}

function getPromptCacheToken(options: BuildOpenUiPromptOptions = {}) {
  const intentVector = getPromptIntentCacheVector(options.prompt);

  return intentVector;
}

const cachedSystemPrompts = new Map<string, string>();
const cachedSystemPromptHashes = new Map<string, string>();
const cachedSystemPromptKeys = new Map<string, string>();

export function buildOpenUiSystemPrompt(options: BuildOpenUiPromptOptions = {}) {
  const cacheToken = getPromptCacheToken(options);
  const cachedPrompt = cachedSystemPrompts.get(cacheToken);

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
    toolExamples: buildToolExamples(options),
    additionalRules: buildAdditionalRules(options),
  });

  cachedSystemPrompts.set(cacheToken, prompt);
  return prompt;
}

export function getOpenUiSystemPromptCacheKey(options: BuildOpenUiPromptOptions = {}) {
  const intentVector = getPromptIntentCacheVector(options.prompt);
  const cacheToken = getPromptCacheToken(options);
  const cachedKey = cachedSystemPromptKeys.get(cacheToken);

  if (cachedKey) {
    return cachedKey;
  }

  const promptHash = createHash('sha256').update(buildOpenUiSystemPrompt(options)).digest('hex').slice(0, 16);
  const cacheKey = `${OPENUI_SYSTEM_PROMPT_CACHE_KEY_PREFIX}:${intentVector}:${componentSpecHash}:${promptHash}`;

  cachedSystemPromptKeys.set(cacheToken, cacheKey);
  return cacheKey;
}

export function getOpenUiSystemPromptHash(options: BuildOpenUiPromptOptions = {}) {
  const cacheToken = getPromptCacheToken(options);
  const cachedHash = cachedSystemPromptHashes.get(cacheToken);

  if (cachedHash) {
    return cachedHash;
  }

  const promptHash = createHash('sha256').update(buildOpenUiSystemPrompt(options)).digest('hex').slice(0, 16);
  cachedSystemPromptHashes.set(cacheToken, promptHash);
  return promptHash;
}
