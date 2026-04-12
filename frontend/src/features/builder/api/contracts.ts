import type { Spec } from '@json-render/core';
import type { BuilderRuntimeState } from '../utils/state';

export type BuilderApiMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type HealthResponse = {
  status: 'ok';
  model: string;
  openaiConfigured: boolean;
  timestamp: string;
};

export type GenerateRequest = {
  prompt: string;
  messages?: BuilderApiMessage[];
  currentSpec?: Spec | null;
  runtimeState?: BuilderRuntimeState | null;
};

export type GenerateResponse = {
  spec: Spec;
  issues: string[];
  rawText: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
};
