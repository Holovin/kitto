import type { ParseResult } from '@openuidev/react-lang';
import { promptHasSimpleTodoIntent, promptMentionsTodoIntent } from '../qualityIntents';
import { extractStringLiteral, isElementNode, type OpenUiQualityIssueSeverity } from './shared';

const SIMPLE_PROMPT_INCLUDE_PATTERN = /\b(todo|to-do|list|form|counter)\b/i;
const SIMPLE_PROMPT_EXCLUDE_PATTERN = /\b(wizard|quiz|multi[\s-]?step|screens?|pages?)\b/i;
const THEME_REQUEST_PATTERN =
  /\b(theme|theming|dark\s+theme|light\s+theme|dark\s+mode|light\s+mode|theme\s+(?:switch|toggle)|toggle\s+(?:the\s+)?theme|switch\s+(?:the\s+)?theme)\b|(?:темн\w*\s+тем\w*|тёмн\w*\s+тем\w*|светл\w*\s+тем\w*|переключател\w*\s+тем\w*|смен\w*\s+тем\w*)/i;
const VISUAL_STYLING_REQUEST_PATTERN =
  /\b(theme|theming|dark|light|color|colors|colour|colours|palette|accent|accents)\b|(?:цвет\w*|палитр\w*|акцент\w*|темн\w*|тёмн\w*|светл\w*)/i;
const COMPUTE_REQUEST_PATTERN =
  /\b(compute|computed|random|calculate|calculation)\b|compare\s+dates?|\bdate\s+comparison\b/i;
const FILTER_REQUEST_PATTERN = /\b(filter|filters|filtered|search)\b/i;
const VALIDATION_REQUEST_PATTERN = /\b(validation|validate|validated|required|error|errors|invalid|rules?)\b/i;
const RANDOM_REQUEST_PATTERN = /\b(random|roll|dice)\b/i;
const QUALITY_COMPUTE_TOOL_NAMES = new Set(['compute_value', 'write_computed_state']);

function isSimplePrompt(prompt: string) {
  return SIMPLE_PROMPT_INCLUDE_PATTERN.test(prompt) && !SIMPLE_PROMPT_EXCLUDE_PATTERN.test(prompt);
}

export function promptRequestsTheme(prompt: string) {
  return THEME_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsVisualStyling(prompt: string) {
  return VISUAL_STYLING_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsTodo(prompt: string) {
  return promptMentionsTodoIntent(prompt);
}

export function promptRequestsCompute(prompt: string) {
  return COMPUTE_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsFiltering(prompt: string) {
  return FILTER_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsValidation(prompt: string) {
  return VALIDATION_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsRandom(prompt: string) {
  return RANDOM_REQUEST_PATTERN.test(prompt);
}

export function getTodoIssueSeverity(prompt: string): OpenUiQualityIssueSeverity {
  return promptHasSimpleTodoIntent(prompt) ? 'blocking-quality' : 'soft-warning';
}

export function isSimplePromptRequest(prompt: string) {
  return isSimplePrompt(prompt);
}

export function hasComputeTools(result: ParseResult) {
  return [...result.queryStatements, ...result.mutationStatements].some((statement) => {
    const toolName = extractStringLiteral(statement.toolAST);

    return toolName ? QUALITY_COMPUTE_TOOL_NAMES.has(toolName) : false;
  });
}

function hasElementType(value: unknown, targetTypeName: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasElementType(entry, targetTypeName));
  }

  if (isElementNode(value)) {
    return value.typeName === targetTypeName || Object.values(value.props).some((entry) => hasElementType(entry, targetTypeName));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((entry) => hasElementType(entry, targetTypeName));
  }

  return false;
}

function hasMutationTool(result: ParseResult, toolName: string) {
  return result.mutationStatements.some((statement) => extractStringLiteral(statement.toolAST) === toolName);
}

export function hasRequiredTodoControls(result: ParseResult, source: string) {
  if (!result.root) {
    return false;
  }

  return (
    hasElementType(result.root, 'Input') &&
    hasElementType(result.root, 'Button') &&
    hasElementType(result.root, 'Repeater') &&
    /@Each\s*\(/.test(source) &&
    result.queryStatements.some((statement) => extractStringLiteral(statement.toolAST) === 'read_state') &&
    (hasMutationTool(result, 'append_state') || hasMutationTool(result, 'append_item'))
  );
}
