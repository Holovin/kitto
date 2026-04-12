import OpenAI from 'openai';
import { compileSpecStream, type Spec } from '@json-render/core';
import { env, isOpenAIConfigured } from '../env.js';
import { buildJsonRenderSystemPrompt, buildJsonRenderUserPrompt, finalizeGeneratedSpec } from '../prompts/json-render.js';
import type { GenerateSpecInput } from '../llm/types.js';

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

let client: OpenAI | null = null;

function getClient() {
  if (!isOpenAIConfigured()) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  if (!client) {
    client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_REQUEST_TIMEOUT_MS,
    });
  }

  return client;
}

function mapUsage(usage?: {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
} | null): TokenUsage | null {
  if (!usage) {
    return null;
  }

  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };
}

export async function generateSpec(input: GenerateSpecInput) {
  const response = await getClient().responses.create({
    model: env.OPENAI_MODEL,
    instructions: buildJsonRenderSystemPrompt(),
    input: buildJsonRenderUserPrompt(input),
  });

  const compiled = compileSpecStream<Record<string, unknown>>(
    response.output_text,
    (input.currentSpec ?? { root: '', elements: {} }) as unknown as Record<string, unknown>,
  );
  const finalized = finalizeGeneratedSpec(compiled as unknown as Spec);

  return {
    spec: finalized.spec,
    issues: finalized.issues,
    rawText: response.output_text,
    usage: mapUsage(response.usage),
  };
}

export function streamSpec(input: GenerateSpecInput) {
  const stream = getClient().responses.stream({
    model: env.OPENAI_MODEL,
    instructions: buildJsonRenderSystemPrompt(),
    input: buildJsonRenderUserPrompt(input),
  });

  return { stream };
}
