export const DEFAULT_LLM_PROMPT_MAX_CHARS = 4_096;
export const DEFAULT_LLM_CHAT_HISTORY_MAX_ITEMS = 40;
export const DEFAULT_LLM_REQUEST_MAX_BYTES = 300_000;
export const DEFAULT_LLM_RATE_LIMIT_MAX_REQUESTS = 60;
export const DEFAULT_LLM_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 120_000;

interface RuntimeConfigSource {
  LLM_CHAT_HISTORY_MAX_ITEMS: number;
  LLM_PROMPT_MAX_CHARS: number;
  LLM_REQUEST_MAX_BYTES: number;
}

export function getPublicRuntimeConfig(env: RuntimeConfigSource) {
  return {
    limits: {
      chatHistoryMaxItems: env.LLM_CHAT_HISTORY_MAX_ITEMS,
      promptMaxChars: env.LLM_PROMPT_MAX_CHARS,
      requestMaxBytes: env.LLM_REQUEST_MAX_BYTES,
    },
  };
}
