import { OPENUI_TOOL_NAMES } from '@kitto-openui/shared/openuiToolRegistry.js';

export const OPENUI_SOURCE_LIMITS = {
  maxSourceChars: 50_000,
  maxStatements: 300,
} as const;

export const OPENUI_VALIDATION_SOURCE_CHAR_LIMIT = OPENUI_SOURCE_LIMITS.maxSourceChars;
export const OPENUI_VALIDATION_STATEMENT_COUNT_LIMIT = OPENUI_SOURCE_LIMITS.maxStatements;

export const ALLOWED_TOOLS: Set<string> = new Set(OPENUI_TOOL_NAMES);

export const UNSAFE_SOURCE_PATTERNS = [/<script/i, /\beval\s*\(/i, /dangerouslySetInnerHTML/i, /javascript:/i];
