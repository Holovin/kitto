import {
  isOpenUiToolName,
  OPENUI_TOOL_NAME_SET,
  type OpenUiToolName,
} from '@kitto-openui/shared/openuiToolRegistry.js';

export const OPENUI_SOURCE_LIMITS = {
  maxSourceChars: 50_000,
  maxStatements: 300,
} as const;

export const ALLOWED_TOOLS: ReadonlySet<OpenUiToolName> = OPENUI_TOOL_NAME_SET;

export function isAllowedToolName(value: string): value is OpenUiToolName {
  return isOpenUiToolName(value);
}

export const ALLOWED_AST_NODE_KINDS: Set<string> = new Set([
  'Arr',
  'Assign',
  'BinOp',
  'Bool',
  'Comp',
  'Index',
  'Member',
  'Null',
  'Num',
  'Obj',
  'Ph',
  'Ref',
  'RuntimeRef',
  'StateRef',
  'Str',
  'Ternary',
  'UnaryOp',
]);

export const ALLOWED_BUILTIN_EXPRESSION_NAMES: Set<string> = new Set([
  'Abs',
  'Action',
  'Avg',
  'Ceil',
  'Count',
  'Each',
  'Filter',
  'First',
  'Floor',
  'Last',
  'Max',
  'Min',
  'OpenUrl',
  'Reset',
  'Round',
  'Run',
  'Set',
  'Sort',
  'Sum',
  'ToAssistant',
]);

// Defence-in-depth for executable-looking syntax outside string literals.
// URL protocols are validated at the Link/@OpenUrl boundary in safeUrl.ts.
export const UNSAFE_SOURCE_PATTERNS = [
  /<\s*\/?\s*script\b/i,
  /\bdangerouslySetInnerHTML\b/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bglobalThis\s*(?:\.|\[\s*['"`])\s*eval\b/i,
];
