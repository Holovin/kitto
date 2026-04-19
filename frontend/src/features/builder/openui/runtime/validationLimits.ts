export const OPENUI_VALIDATION_SOURCE_CHAR_LIMIT = 16_000;
export const OPENUI_VALIDATION_STATEMENT_COUNT_LIMIT = 200;

export const ALLOWED_TOOLS = new Set([
  'read_state',
  'write_state',
  'merge_state',
  'append_state',
  'remove_state',
]);

export const UNSAFE_SOURCE_PATTERNS = [/<script/i, /\beval\s*\(/i, /dangerouslySetInnerHTML/i, /javascript:/i];
