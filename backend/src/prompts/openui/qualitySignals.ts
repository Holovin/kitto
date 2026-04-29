import type { ParseResult } from '@openuidev/lang-core';
import { findFunctionCalls } from '@kitto-openui/shared/openuiSourceParsing.js';
import { promptMentionsTodoIntent, promptRequiresBlockingTodoControls } from './qualityIntents.js';
import { extractStringLiteral, isElementNode, type BuilderQualityIssueSeverity } from '#backend/prompts/openui/quality/shared.js';
export { detectChoiceOptionsShapeIssues } from '#backend/prompts/openui/quality/detectors/optionsShape.js';

const SIMPLE_PROMPT_INCLUDE_PATTERN = /\b(todo|to-do|list|form|counter)\b/i;
const SIMPLE_PROMPT_EXCLUDE_PATTERN = /\b(wizard|quiz|multi[\s-]?step|screens?|pages?)\b/i;
const THEME_NEGATION_PATTERN =
  /\b(?:do\s+not|don't|dont|without|no|avoid|skip|disable|remove)\b[^.!?\n]{0,80}\b(?:theme|theming|dark\s+(?:theme|mode)|light\s+(?:theme|mode)|theme\s+(?:switch|toggle)|toggle\s+(?:the\s+)?theme|switch\s+(?:the\s+)?theme)\b|(?:\b(?:не|без|избегай|пропусти|отключи|убери|удали)\b[^.!?\n]{0,80}(?:тем\w*|переключател\w*\s+тем\w*))/i;
const VISUAL_STYLING_NEGATION_PATTERN =
  /\b(?:do\s+not|don't|dont|without|no|avoid|skip|disable|remove)\b[^.!?\n]{0,80}\b(?:theme|theming|styles?|styling|palette|colou?rs?|accents?|dark\s+(?:theme|mode|background|surface|ui|interface)|light\s+(?:theme|mode|background|surface|ui|interface))\b|(?:\b(?:не|без|избегай|пропусти|отключи|убери|удали)\b[^.!?\n]{0,80}(?:стил\w*|цвет\w*|палитр\w*|акцент\w*|тем\w*|тёмн\w*|светл\w*))/i;
const THEME_REQUEST_PATTERN =
  /\b(theme|theming|dark\s+theme|light\s+theme|dark\s+mode|light\s+mode|theme\s+(?:switch|toggle)|toggle\s+(?:the\s+)?theme|switch\s+(?:the\s+)?theme)\b|(?:темн\w*\s+тем\w*|тёмн\w*\s+тем\w*|светл\w*\s+тем\w*|переключател\w*\s+тем\w*|смен\w*\s+тем\w*)/i;
const THEME_STATE_REQUEST_PATTERN =
  /\b(theme\s+(?:switch|toggle)|toggle\s+(?:the\s+)?theme|switch\s+(?:the\s+)?theme|(?:light|dark)\s+and\s+(?:light|dark)\s+(?:themes?|modes?)|(?:light|dark)\s*\/\s*(?:light|dark)\s+(?:themes?|modes?))\b|(?:переключател\w*\s+тем\w*|смен\w*\s+тем\w*|светл\w*.*темн\w*|тёмн\w*.*светл\w*)/i;
const VISUAL_STYLING_REQUEST_PATTERN =
  /\b(?:visual\s+styles?|styling|colou?r\s+(?:scheme|palette)|(?:background|text|button|accent)\s+colou?r|dark\s+(?:background|surface|ui|interface)|light\s+(?:background|surface|ui|interface))\b|(?:цветов\w*\s+схем\w*|цвет\w*\s+(?:фон\w*|текст\w*|кноп\w*|акцент\w*)|палитр\w*|акцентн\w*\s+цвет\w*|т[её]мн\w*\s+(?:фон\w*|интерфейс\w*)|светл\w*\s+(?:фон\w*|интерфейс\w*))/i;
const COMPUTE_REQUEST_PATTERN =
  /\b(?:compute|computed|calculator)\b|\b(?:calculate|calculation)\s+(?:an?\s+|the\s+)?(?:totals?|sums?|scores?|averages?|percentages?|differences?|amounts?|prices?|costs?|budgets?|balances?|values?|results?|bmi|tax(?:es)?|dates?|deadlines?)\b|\b(?:total|sum|average|percentage|score|bmi)\s+(?:calculator|calculation)\b|compare\s+dates?|\bdate\s+comparison\b|(?:расч[её]т[а-яё]*|посчита[а-яё]*|сравн[а-яё]*\s+дат[а-яё]*|случайн[а-яё]*|рандом[а-яё]*|кубик[а-яё]*)/i;
const FILTER_REQUEST_PATTERN = /\b(filter(?:s|ed|ing)?|search)\b|(?:фильтр[а-яё]*|поиск[а-яё]*)/i;
const DELETE_REQUEST_PATTERN =
  /\b(?:delete|remove|discard|clear)\s+(?:an?\s+|the\s+|this\s+|that\s+|last\s+|first\s+)?(?:item|task|todo|row|entry|screen|page|field|section|card|record|value|state|list)\b|^\s*(?:delete|remove|discard|clear)\b|(?:удали|убери|очисти|удалить|убрать|очистить)\s+(?:задач\w*|элемент\w*|строк\w*|экран\w*|пол[ея]\w*|секци\w*|значени\w*|спис\w*)/i;
const VALIDATION_REQUEST_PATTERN =
  /\b(?:validation|validate|validated|required|invalid|validation\s+rules?|form\s+rules?|field\s+rules?|input\s+rules?|(?:error|warning)\s+(?:when|if|for|on)\s+(?:invalid|required|empty)|show\s+(?:an?\s+)?(?:error|warning)\s+(?:when|if))\b|(?:валидац[а-яё]*|обязател[а-яё]*|некорректн[а-яё]*|(?:ошибк[а-яё]*|предупрежден[а-яё]*)\s+(?:если|при)\s+(?:некорректн[а-яё]*|пуст[а-яё]*|обязател[а-яё]*))/i;
const RANDOM_REQUEST_PATTERN = /\b(random|roll|dice)\b|(?:случайн[а-яё]*|рандом[а-яё]*|кубик[а-яё]*)/i;
const CONTROL_SHOWCASE_REQUEST_PATTERN =
  /\b(?:every|all|each)\s+(?:control|component|field|input)s?\b|\b(?:control|component)\s+showcase\b|(?:все\s+(?:контрол[а-яё]*|компонент[а-яё]*|пол[яеи])|кажд[а-яё]*\s+(?:контрол[а-яё]*|компонент[а-яё]*))/i;
const MULTI_SCREEN_REQUEST_PATTERN =
  /\b(wizard|quiz|onboarding|multi[\s-]?(?:step|screen|page)|two[\s-]?step|three[\s-]?step|next\s+screen|confirmation\s+screen|result\s+screen|screen\s+flow)\b|\b(?:two|three|four|five|several|multiple)\s+(?:screens?|pages?)\b|\b\d+\s+(?:screens?|pages?)\b|(?:многошаг\w*|нескольк\w*\s+экран\w*|втор\w*\s+экран\w*|экран\s+после|квиз\w*|викторин\w*|онбординг\w*|пошагов\w*)/i;
const STEP_FLOW_REQUEST_PATTERN =
  /\b(wizard|quiz|onboarding|multi[\s-]?step|two[\s-]?step|three[\s-]?step|next\s+screen|confirmation\s+screen|result\s+screen|screen\s+flow|step[\s-]?by[\s-]?step)\b|(?:многошаг\w*|экран\s+после|квиз\w*|викторин\w*|онбординг\w*|пошагов\w*)/i;
const QUALITY_COMPUTE_TOOL_NAMES = new Set(['compute_value', 'write_computed_state']);
const TODO_TOGGLE_MUTATION_TOOL_NAMES = new Set(['toggle_item_field', 'update_item_field']);
const REQUIRED_CONTROL_SHOWCASE_COMPONENTS = ['Input', 'TextArea', 'Checkbox', 'RadioGroup', 'Select', 'Button', 'Link'] as const;

function isSimplePrompt(prompt: string) {
  return SIMPLE_PROMPT_INCLUDE_PATTERN.test(prompt) && !SIMPLE_PROMPT_EXCLUDE_PATTERN.test(prompt);
}

export function promptRequestsTheme(prompt: string) {
  return !THEME_NEGATION_PATTERN.test(prompt) && THEME_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsThemeState(prompt: string) {
  return !THEME_NEGATION_PATTERN.test(prompt) && THEME_STATE_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsVisualStyling(prompt: string) {
  return !VISUAL_STYLING_NEGATION_PATTERN.test(prompt) && VISUAL_STYLING_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsThemeOrVisualStyling(prompt: string) {
  return promptRequestsTheme(prompt) || promptRequestsThemeState(prompt) || promptRequestsVisualStyling(prompt);
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

export function promptRequestsDelete(prompt: string) {
  return DELETE_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsValidation(prompt: string) {
  return VALIDATION_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsRandom(prompt: string) {
  return RANDOM_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsControlShowcase(prompt: string) {
  return CONTROL_SHOWCASE_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsMultiScreen(prompt: string) {
  return MULTI_SCREEN_REQUEST_PATTERN.test(prompt);
}

export function promptRequestsStepFlow(prompt: string) {
  return STEP_FLOW_REQUEST_PATTERN.test(prompt);
}

export function getTodoIssueSeverity(prompt: string): BuilderQualityIssueSeverity {
  return promptRequiresBlockingTodoControls(prompt) ? 'blocking-quality' : 'soft-warning';
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

function getMutationStatementIdsForTools(result: ParseResult, toolNames: ReadonlySet<string>) {
  return new Set(
    result.mutationStatements.flatMap((statement) =>
      toolNames.has(extractStringLiteral(statement.toolAST) ?? '') ? [statement.statementId] : [],
    ),
  );
}

function getReadStateQueryStatementIds(result: ParseResult) {
  return new Set(
    result.queryStatements.flatMap((statement) =>
      extractStringLiteral(statement.toolAST) === 'read_state' ? [statement.statementId] : [],
    ),
  );
}

function normalizeRunRefArg(value: string | undefined) {
  const trimmedValue = value?.trim() ?? '';

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedValue) ? trimmedValue : null;
}

function getActionRunRefs(actionSource: string) {
  return findFunctionCalls(actionSource, 'Run').flatMap((runCall) => {
    const runRef = normalizeRunRefArg(runCall.args[0]);

    return runRef ? [runRef] : [];
  });
}

function hasPersistedTodoToggleAndRefreshAction(
  actionSource: string,
  toggleMutationIds: ReadonlySet<string>,
  readStateQueryIds: ReadonlySet<string>,
) {
  if (!/\bAction\s*\(/.test(actionSource)) {
    return false;
  }

  const runRefs = getActionRunRefs(actionSource);

  for (const [index, runRef] of runRefs.entries()) {
    if (!toggleMutationIds.has(runRef)) {
      continue;
    }

    if (runRefs.slice(index + 1).some((laterRunRef) => readStateQueryIds.has(laterRunRef))) {
      return true;
    }
  }

  return false;
}

function hasInteractiveTodoToggleInRows(result: ParseResult, source: string) {
  const toggleMutationIds = getMutationStatementIdsForTools(result, TODO_TOGGLE_MUTATION_TOOL_NAMES);
  const readStateQueryIds = getReadStateQueryStatementIds(result);

  if (toggleMutationIds.size === 0 || readStateQueryIds.size === 0) {
    return false;
  }

  return findFunctionCalls(source, 'Each').some((eachCall) => {
    const rowSource = eachCall.args[2] ?? '';

    return findFunctionCalls(rowSource, 'Checkbox').some((checkboxCall) =>
      hasPersistedTodoToggleAndRefreshAction(checkboxCall.args[5] ?? '', toggleMutationIds, readStateQueryIds),
    );
  });
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
    (hasMutationTool(result, 'append_state') || hasMutationTool(result, 'append_item')) &&
    hasInteractiveTodoToggleInRows(result, source)
  );
}

export function getMissingControlShowcaseComponents(result: ParseResult) {
  if (!result.root) {
    return [...REQUIRED_CONTROL_SHOWCASE_COMPONENTS];
  }

  return REQUIRED_CONTROL_SHOWCASE_COMPONENTS.filter((componentName) => !hasElementType(result.root, componentName));
}
