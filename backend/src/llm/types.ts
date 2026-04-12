import type { Spec } from '@json-render/core';

export type BuilderMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type RepairContext = {
  attempt: number;
  error: string;
  rawLines?: string[];
};

export type GenerateSpecInput = {
  prompt: string;
  messages?: BuilderMessage[];
  currentSpec?: Spec | null;
  runtimeState?: Record<string, unknown> | null;
  repairContext?: RepairContext;
};

export type RequestCompactionAction = 'chat-history' | 'repair-raw-lines';

export type RequestNormalizationMeta = {
  compacted: boolean;
  actions: RequestCompactionAction[];
  requestBytes: number;
  droppedMessages: number;
  droppedRawLines: boolean;
};
