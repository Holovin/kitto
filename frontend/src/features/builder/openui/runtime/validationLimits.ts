export const OPENUI_SOURCE_LIMITS = {
  maxSourceChars: 50_000,
  maxStatements: 300,
} as const;

export const OPENUI_VALIDATION_SOURCE_CHAR_LIMIT = OPENUI_SOURCE_LIMITS.maxSourceChars;
export const OPENUI_VALIDATION_STATEMENT_COUNT_LIMIT = OPENUI_SOURCE_LIMITS.maxStatements;

export const ALLOWED_TOOLS = new Set([
  'read_state',
  'write_state',
  'merge_state',
  'append_state',
  'remove_state',
  'compute_value',
  'write_computed_state',
]);

export const UNSAFE_SOURCE_PATTERNS = [/<script/i, /\beval\s*\(/i, /dangerouslySetInnerHTML/i, /javascript:/i];
