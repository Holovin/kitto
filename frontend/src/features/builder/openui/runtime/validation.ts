import { createParser, type ParseResult } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { ACTION_MODE_LAST_CHOICE_STATE, HEX_COLOR_PATTERN, inspectValidationConfig } from '@features/builder/openui/library/components/shared';
import type { BuilderParseIssue, BuilderParseIssueSuggestion } from '@features/builder/types';
import { promptHasSimpleTodoIntent, promptMentionsTodoIntent } from './qualityIntents';
import {
  ALLOWED_TOOLS,
  OPENUI_SOURCE_LIMITS,
  UNSAFE_SOURCE_PATTERNS,
} from './validationLimits';

const parser = createParser(builderOpenUiLibrary.toJSONSchema());
const componentSchemaDefinitions = (builderOpenUiLibrary.toJSONSchema().$defs ?? {}) as Record<
  string,
  {
    properties?: Record<
      string,
      {
        enum?: unknown[];
      }
    >;
  }
>;

interface OpenUiValidationResult {
  isValid: boolean;
  issues: BuilderParseIssue[];
}

interface OpenUiFunctionCallMatch {
  args: string[];
  text: string;
}

type ToolAst = ParseResult['queryStatements'][number]['toolAST'] | ParseResult['mutationStatements'][number]['toolAST'];

interface OpenUiQualityMetrics {
  blockGroupCount: number;
  hasThemeStyling: boolean;
  hasValidationRules: boolean;
  screenCount: number;
}

const SIMPLE_PROMPT_INCLUDE_PATTERN = /\b(todo|to-do|list|form|counter)\b/i;
const SIMPLE_PROMPT_EXCLUDE_PATTERN = /\b(wizard|quiz|multi[\s-]?step|screens?|pages?)\b/i;
const THEME_REQUEST_PATTERN = /\b(theme|theming|dark|light|color|colors|colour|colours|palette)\b/i;
const COMPUTE_REQUEST_PATTERN =
  /\b(compute|computed|random|calculate|calculation)\b|compare\s+dates?|\bdate\s+comparison\b/i;
const FILTER_REQUEST_PATTERN = /\b(filter|filters|filtered|search)\b/i;
const VALIDATION_REQUEST_PATTERN = /\b(validation|validate|validated|required|error|errors|invalid|rules?)\b/i;
const RANDOM_REQUEST_PATTERN = /\b(random|roll|dice)\b/i;
const MAX_SIMPLE_PROMPT_BLOCK_GROUPS = 4;
const QUALITY_COMPUTE_TOOL_NAMES = new Set(['compute_value', 'write_computed_state']);
const ITEM_SCOPED_CONTROL_TYPE_NAMES = new Set(['Checkbox', 'Input', 'RadioGroup', 'Select', 'TextArea']);
const ARRAY_INDEX_PATH_MUTATION_TOOL_NAMES = new Set(['merge_state', 'remove_state', 'write_state']);
const REFRESHABLE_PERSISTED_MUTATION_TOOL_NAMES = new Set([
  'append_state',
  'append_item',
  'merge_state',
  'remove_item',
  'remove_state',
  'toggle_item_field',
  'update_item_field',
  'write_computed_state',
  'write_state',
]);
const RESERVED_INLINE_TOOL_CALL_NAMES = new Set(['Mutation', 'Query']);

type ExpressionAst = {
  args?: ExpressionAst[];
  entries?: Array<[string, ExpressionAst]>;
  k: string;
  n?: string;
  name?: string;
  refType?: string;
  v?: string;
};

type ActionRunRef = {
  refType: 'mutation' | 'query';
  statementId: string;
};

type OwnedActionRunRefGroup = {
  ownerStatementId?: string;
  ownerTypeName?: string;
  runRefs: ActionRunRef[];
};

type PersistedPathStatementRef = {
  path: string;
  statementId: string;
};

export type OpenUiQualityIssueSeverity = 'blocking-quality' | 'fatal-quality' | 'soft-warning';

export interface OpenUiQualityIssue extends BuilderParseIssue {
  severity: OpenUiQualityIssueSeverity;
}

const THEME_CONTAINER_TYPE_NAMES = new Set(['AppShell', 'Group', 'Repeater', 'Screen']);
const ACTION_MODE_CHOICE_COMPONENT_NAMES = new Set(['RadioGroup', 'Select']);

function normalizeSourceForValidation(source: string) {
  return source.trim();
}

function createParserIssue(issue: Omit<BuilderParseIssue, 'source'>): BuilderParseIssue {
  return {
    ...issue,
    source: 'parser',
  };
}

function createQualityIssue(issue: Omit<BuilderParseIssue, 'source'>): BuilderParseIssue {
  return {
    ...issue,
    source: 'quality',
  };
}

function createOpenUiQualityIssue(
  severity: OpenUiQualityIssueSeverity,
  issue: Omit<BuilderParseIssue, 'source'>,
): OpenUiQualityIssue {
  return {
    ...issue,
    severity,
    source: 'quality',
  };
}

function mapParserIssues(result: ParseResult): BuilderParseIssue[] {
  return result.meta.errors.map((error) =>
    createParserIssue({
      code: error.code,
      message: error.message,
      statementId: error.statementId,
    }),
  );
}

function extractStringLiteral(toolAst: ToolAst) {
  if (!toolAst || toolAst.k !== 'Str') {
    return null;
  }

  return toolAst.v;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskStringLiterals(source: string) {
  let maskedSource = '';
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;

  for (const character of source) {
    if (activeQuote) {
      if (isEscaped) {
        isEscaped = false;
        maskedSource += ' ';
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        maskedSource += ' ';
        continue;
      }

      if (character === activeQuote) {
        activeQuote = null;
      }

      maskedSource += ' ';
      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      maskedSource += ' ';
      continue;
    }

    maskedSource += character;
  }

  return maskedSource;
}

function createReplaceTextSuggestion(from: string, to: string): BuilderParseIssueSuggestion | undefined {
  if (!from || from === to) {
    return undefined;
  }

  return {
    kind: 'replace-text',
    from,
    to,
  };
}

function findMatchingDelimiter(source: string, openIndex: number, openChar: string, closeChar: string) {
  let depth = 0;
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];

    if (activeQuote) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === activeQuote) {
        activeQuote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (character === openChar) {
      depth += 1;
      continue;
    }

    if (character === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevelArgs(source: string) {
  const args: string[] = [];
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;
  let curlyDepth = 0;
  let parenDepth = 0;
  let squareDepth = 0;
  let segmentStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (activeQuote) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === activeQuote) {
        activeQuote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (character === '{') {
      curlyDepth += 1;
      continue;
    }

    if (character === '}') {
      curlyDepth -= 1;
      continue;
    }

    if (character === '(') {
      parenDepth += 1;
      continue;
    }

    if (character === ')') {
      parenDepth -= 1;
      continue;
    }

    if (character === '[') {
      squareDepth += 1;
      continue;
    }

    if (character === ']') {
      squareDepth -= 1;
      continue;
    }

    if (character === ',' && curlyDepth === 0 && parenDepth === 0 && squareDepth === 0) {
      args.push(source.slice(segmentStart, index).trim());
      segmentStart = index + 1;
    }
  }

  const trailingSegment = source.slice(segmentStart).trim();

  if (trailingSegment) {
    args.push(trailingSegment);
  }

  return args;
}

function findFunctionCalls(source: string, functionName: string): OpenUiFunctionCallMatch[] {
  const matches: OpenUiFunctionCallMatch[] = [];
  const callPattern = new RegExp(`\\b${escapeRegExp(functionName)}\\s*\\(`, 'g');
  let match = callPattern.exec(source);

  while (match) {
    const matchText = match[0] ?? '';
    const openParenIndex = (match.index ?? 0) + matchText.lastIndexOf('(');
    const closeParenIndex = findMatchingDelimiter(source, openParenIndex, '(', ')');

    if (closeParenIndex >= 0) {
      const callText = source.slice(match.index ?? 0, closeParenIndex + 1);
      const argsSource = source.slice(openParenIndex + 1, closeParenIndex);
      matches.push({
        args: splitTopLevelArgs(argsSource),
        text: callText,
      });
    }

    match = callPattern.exec(source);
  }

  return matches;
}

function formatFunctionCall(functionName: string, args: string[]) {
  return `${functionName}(${args.join(', ')})`;
}

function isArrayLiteral(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue.startsWith('[') && trimmedValue.endsWith(']');
}

function isObjectLiteral(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue.startsWith('{') && trimmedValue.endsWith('}');
}

function parseStringLiteralValue(value: string) {
  const trimmedValue = value.trim();

  if (
    trimmedValue.length >= 2 &&
    ((trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) || (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return null;
}

function parseAppearanceEntries(value: string) {
  if (!isObjectLiteral(value)) {
    return null;
  }

  const objectBody = value.trim().slice(1, -1).trim();

  if (!objectBody) {
    return [];
  }

  const entries = splitTopLevelArgs(objectBody).map((entrySource, index) => {
    const entryMatch = entrySource.match(/^([A-Za-z_][\w-]*)\s*:\s*([\s\S]+)$/);

    if (!entryMatch) {
      return null;
    }

    return {
      index,
      key: entryMatch[1],
      value: entryMatch[2].trim(),
    };
  });

  return entries.every((entry) => entry != null) ? entries : null;
}

function normalizeAppearanceObject(componentName: string, rawAppearance: string) {
  const entries = parseAppearanceEntries(rawAppearance);

  if (entries == null) {
    return null;
  }

  let hasChanges = false;
  const bestEntryByKey = new Map<
    string,
    {
      index: number;
      key: string;
      priority: number;
      value: string;
    }
  >();

  for (const entry of entries) {
    let nextKey = entry.key;
    let keepEntry = true;
    let priority = 2;

    if (componentName === 'Text') {
      if (entry.key === 'mainColor' || entry.key === 'textColor' || entry.key === 'color') {
        nextKey = 'contrastColor';
        priority = entry.key === 'contrastColor' ? 2 : 1;
      } else if (entry.key === 'bgColor' || entry.key === 'background' || entry.key === 'backgroundColor') {
        keepEntry = false;
      } else if (entry.key !== 'contrastColor') {
        keepEntry = false;
      }
    } else {
      if (entry.key === 'textColor' || entry.key === 'color') {
        nextKey = 'contrastColor';
        priority = 1;
      } else if (entry.key === 'bgColor' || entry.key === 'background' || entry.key === 'backgroundColor') {
        nextKey = 'mainColor';
        priority = 1;
      } else if (entry.key !== 'mainColor' && entry.key !== 'contrastColor') {
        keepEntry = false;
      }
    }

    if (nextKey !== entry.key || !keepEntry) {
      hasChanges = true;
    }

    if (!keepEntry) {
      continue;
    }

    const currentBestEntry = bestEntryByKey.get(nextKey);

    if (
      !currentBestEntry ||
      priority > currentBestEntry.priority ||
      (priority === currentBestEntry.priority && entry.index > currentBestEntry.index)
    ) {
      bestEntryByKey.set(nextKey, {
        index: entry.index,
        key: nextKey,
        priority,
        value: entry.value,
      });
    }
  }

  if (!hasChanges) {
    return null;
  }

  const normalizedEntries = [...bestEntryByKey.values()]
    .sort((left, right) => left.index - right.index)
    .map((entry) => `${entry.key}: ${entry.value}`);

  return normalizedEntries.length > 0 ? `{ ${normalizedEntries.join(', ')} }` : '{}';
}

function collectArgumentAutoFixIssues(source: string): BuilderParseIssue[] {
  const issues: BuilderParseIssue[] = [];

  for (const call of findFunctionCalls(source, 'AppShell')) {
    if (call.args.length === 0) {
      const suggestion = createReplaceTextSuggestion(call.text, 'AppShell([])');

      if (suggestion) {
        issues.push(
          createParserIssue({
            code: 'invalid-args',
            message: 'AppShell is missing the required children array. Use AppShell(children, appearance?).',
            statementId: 'root',
            suggestion,
          }),
        );
      }

      continue;
    }

    if (call.args.length === 1 && isObjectLiteral(call.args[0])) {
      const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall('AppShell', ['[]', call.args[0]]));

      if (suggestion) {
        issues.push(
          createParserIssue({
            code: 'invalid-args',
            message: 'AppShell is missing the required children array. Use AppShell(children, appearance?).',
            statementId: 'root',
            suggestion,
          }),
        );
      }

      continue;
    }

    if (call.args.length === 2 && isObjectLiteral(call.args[0]) && isArrayLiteral(call.args[1])) {
      const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall('AppShell', [call.args[1], call.args[0]]));

      if (suggestion) {
        issues.push(
          createParserIssue({
            code: 'invalid-args',
            message: 'AppShell arguments are out of order. Use AppShell(children, appearance?).',
            statementId: 'root',
            suggestion,
          }),
        );
      }
    }
  }

  for (const call of findFunctionCalls(source, 'Screen')) {
    if (call.args.length === 2) {
      const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall('Screen', [...call.args, '[]']));

      if (suggestion) {
        issues.push(
          createParserIssue({
            code: 'invalid-args',
            message: 'Screen is missing the required children array. Use Screen(id, title, children, isActive?, appearance?).',
            suggestion,
          }),
        );
      }
    }
  }

  for (const call of findFunctionCalls(source, 'Group')) {
    if (call.args.length < 2) {
      continue;
    }

    const secondArgValue = call.args[1]?.trim() ?? '';
    const thirdArgValue = call.args[2]?.trim() ?? '';
    let nextArgs: string[] | null = null;
    let message = '';

    if (isArrayLiteral(secondArgValue)) {
      const thirdLiteral = parseStringLiteralValue(thirdArgValue);

      if (!thirdArgValue) {
        nextArgs = [call.args[0], '"vertical"', call.args[1]];
        message = 'Group is missing the required direction argument before children. Use Group(title, direction, children, variant?, appearance?).';
      } else if (thirdLiteral === 'vertical' || thirdLiteral === 'horizontal') {
        nextArgs = [call.args[0], call.args[2], call.args[1], ...call.args.slice(3)];
        message = 'Group arguments are out of order. Use Group(title, direction, children, variant?, appearance?).';
      } else if (thirdLiteral === 'block' || thirdLiteral === 'inline') {
        nextArgs = [call.args[0], '"vertical"', call.args[1], call.args[2], ...call.args.slice(3)];
        message =
          'Group children were passed before direction. Use Group(title, direction, children, variant?, appearance?) and keep "block" or "inline" in the optional fourth argument.';
      }
    } else {
      const secondLiteral = parseStringLiteralValue(secondArgValue);

      if ((secondLiteral === 'block' || secondLiteral === 'inline') && isArrayLiteral(thirdArgValue)) {
        nextArgs = [call.args[0], '"vertical"', call.args[2], call.args[1], ...call.args.slice(3)];
        message = 'Group variant was passed where direction belongs. Use Group(title, direction, children, variant?, appearance?).';
      }
    }

    if (!nextArgs) {
      continue;
    }

    const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall('Group', nextArgs));

    if (suggestion) {
      issues.push(
        createParserIssue({
          code: 'invalid-args',
          message,
          suggestion,
        }),
      );
    }
  }

  return issues;
}

function collectAppearanceAutoFixIssues(source: string): BuilderParseIssue[] {
  const issues: BuilderParseIssue[] = [];
  const componentNames = ['AppShell', 'Button', 'Checkbox', 'Group', 'Input', 'Link', 'RadioGroup', 'Repeater', 'Screen', 'Select', 'Text', 'TextArea'];

  for (const componentName of componentNames) {
    for (const call of findFunctionCalls(source, componentName)) {
      for (const [index, arg] of call.args.entries()) {
        if (!isObjectLiteral(arg)) {
          continue;
        }

        const normalizedAppearanceObject = normalizeAppearanceObject(componentName, arg);

        if (!normalizedAppearanceObject) {
          continue;
        }

        const nextArgs = [...call.args];
        nextArgs[index] = normalizedAppearanceObject;
        const suggestion = createReplaceTextSuggestion(call.text, formatFunctionCall(componentName, nextArgs));

        if (!suggestion) {
          continue;
        }

        issues.push(
          createParserIssue({
            code: 'invalid-prop',
            message:
              componentName === 'Text'
                ? 'Text.appearance supports only contrastColor. Replace legacy or unsupported appearance keys locally before commit.'
                : `${componentName}.appearance should use only mainColor and contrastColor keys.`,
            suggestion,
          }),
        );
      }
    }
  }

  return issues;
}

function appendAutoFixSuggestionIssues(source: string, issues: BuilderParseIssue[]) {
  return [...issues, ...collectArgumentAutoFixIssues(source), ...collectAppearanceAutoFixIssues(source)];
}

export function applyOpenUiIssueSuggestions(source: string, issues: BuilderParseIssue[]) {
  const suggestions = issues
    .flatMap((issue) => (issue.suggestion ? [{ issue, suggestion: issue.suggestion }] : []))
    .filter(({ suggestion }) => suggestion.kind === 'replace-text' && suggestion.from && suggestion.from !== suggestion.to)
    .sort((left, right) => right.suggestion.from.length - left.suggestion.from.length);
  let nextSource = source;
  const appliedIssues: BuilderParseIssue[] = [];

  for (const { issue, suggestion } of suggestions) {
    if (!nextSource.includes(suggestion.from)) {
      continue;
    }

    nextSource = nextSource.replace(suggestion.from, suggestion.to);
    appliedIssues.push(issue);
  }

  return {
    appliedIssues,
    source: nextSource,
  };
}

function isSafeMutationReferenceUse(line: string, referenceIndex: number, statementId: string) {
  const beforeReference = line.slice(0, referenceIndex);
  const afterReference = line.slice(referenceIndex + statementId.length);

  if (/^\s*$/.test(beforeReference) && /^\s*=\s*Mutation\s*\(/.test(afterReference)) {
    return true;
  }

  if (/@Run\(\s*$/.test(beforeReference) && /^\s*\)/.test(afterReference)) {
    return true;
  }

  if (/^\s*\.(data|status|error)\b/.test(afterReference)) {
    return true;
  }

  return false;
}

function validateMutationReferenceUsage(source: string, result: ParseResult): BuilderParseIssue[] {
  if (result.meta.incomplete || result.mutationStatements.length === 0) {
    return [];
  }

  const maskedSource = maskStringLiterals(source);
  const issues: BuilderParseIssue[] = [];

  for (const mutation of result.mutationStatements) {
    const referencePattern = new RegExp(`(?<![\\w$])${escapeRegExp(mutation.statementId)}(?![\\w$])`, 'g');
    const maskedLines = maskedSource.split('\n');

    for (const line of maskedLines) {
      let match: RegExpExecArray | null = referencePattern.exec(line);

      while (match) {
        const matchIndex = match.index ?? 0;

        if (!isSafeMutationReferenceUse(line, matchIndex, mutation.statementId)) {
          issues.push(
            createParserIssue({
              code: 'invalid-mutation-reference',
              message: `Mutation statement "${mutation.statementId}" cannot be used as a bare UI value. Read the persisted value with Query("read_state", ...) or use ${mutation.statementId}.data.value after checking ${mutation.statementId}.status.`,
              statementId: mutation.statementId,
            }),
          );
          break;
        }

        match = referencePattern.exec(line);
      }
    }
  }

  return issues;
}

function isElementNode(
  value: unknown,
): value is {
  props: Record<string, unknown>;
  statementId?: string;
  type: 'element';
  typeName: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'element' &&
    'typeName' in value &&
    typeof value.typeName === 'string' &&
    'props' in value &&
    typeof value.props === 'object' &&
    value.props !== null
  );
}

function isLiteralObjectValue(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  if ('k' in value && typeof value.k === 'string') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function isWritableBindingValue(value: unknown) {
  return isAstNode(value) && value.k === 'StateRef';
}

function inspectQualityNode(value: unknown, metrics: OpenUiQualityMetrics) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      inspectQualityNode(entry, metrics);
    }

    return;
  }

  if (!isElementNode(value)) {
    if (typeof value === 'object' && value !== null) {
      for (const nestedValue of Object.values(value)) {
        inspectQualityNode(nestedValue, metrics);
      }
    }

    return;
  }

  if (value.typeName === 'Screen') {
    metrics.screenCount += 1;
  }

  if (value.typeName === 'Group' && value.props.variant !== 'inline') {
    metrics.blockGroupCount += 1;
  }

  if (value.props.appearance != null) {
    metrics.hasThemeStyling = true;
  }

  if (Array.isArray(value.props.validation) ? value.props.validation.length > 0 : value.props.validation != null) {
    metrics.hasValidationRules = true;
  }

  for (const nestedValue of Object.values(value.props)) {
    inspectQualityNode(nestedValue, metrics);
  }
}

function collectQualityMetrics(value: unknown): OpenUiQualityMetrics {
  const metrics: OpenUiQualityMetrics = {
    blockGroupCount: 0,
    hasThemeStyling: false,
    hasValidationRules: false,
    screenCount: 0,
  };

  inspectQualityNode(value, metrics);

  return metrics;
}

function validateLiteralProps(value: unknown, inheritedStatementId?: string): BuilderParseIssue[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => validateLiteralProps(entry, inheritedStatementId));
  }

  if (!isElementNode(value)) {
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).flatMap((entry) => validateLiteralProps(entry, inheritedStatementId));
    }

    return [];
  }

  const statementId = value.statementId ?? inheritedStatementId;
  const componentSchema = componentSchemaDefinitions[value.typeName];
  const issues: BuilderParseIssue[] = [];
  const appearanceValue = value.props.appearance;

  for (const [propName, propSchema] of Object.entries(componentSchema?.properties ?? {})) {
    const propValue = value.props[propName];

    if (typeof propValue !== 'string' || !Array.isArray(propSchema.enum) || propSchema.enum.includes(propValue)) {
      continue;
    }

    issues.push(
      createParserIssue({
        code: 'invalid-prop',
        message: `${value.typeName}.${propName} must be one of ${propSchema.enum.map((option) => `"${option}"`).join(', ')}.`,
        statementId,
      }),
    );
  }

  if (isLiteralObjectValue(appearanceValue)) {
    const allowedAppearanceKeys = value.typeName === 'Text' ? new Set(['contrastColor']) : new Set(['mainColor', 'contrastColor']);

    for (const [appearanceKey, appearancePropValue] of Object.entries(appearanceValue)) {
      if (!allowedAppearanceKeys.has(appearanceKey)) {
        issues.push(
          createParserIssue({
            code: 'invalid-prop',
            message: `${value.typeName}.appearance.${appearanceKey} is not allowed.`,
            statementId,
          }),
        );
        continue;
      }

      if (typeof appearancePropValue === 'string' && !HEX_COLOR_PATTERN.test(appearancePropValue)) {
        issues.push(
          createParserIssue({
            code: 'invalid-prop',
            message: `${value.typeName}.appearance.${appearanceKey} must be a #RRGGBB hex color.`,
            statementId,
          }),
        );
      }
    }
  }

  if (
    value.typeName === 'Input' ||
    value.typeName === 'TextArea' ||
    value.typeName === 'Select' ||
    value.typeName === 'RadioGroup' ||
    value.typeName === 'Checkbox'
  ) {
    const validationIssues = inspectValidationConfig({
      componentType: value.typeName,
      inputType: value.typeName === 'Input' ? value.props.type : undefined,
      validation: value.props.validation,
    });

    for (const validationIssue of validationIssues) {
      issues.push(
        createParserIssue({
          code: 'invalid-prop',
          message: validationIssue.message,
          statementId,
        }),
      );
    }
  }

  for (const nestedValue of Object.values(value.props)) {
    issues.push(...validateLiteralProps(nestedValue, statementId));
  }

  return issues;
}

function detectControlActionBindingConflicts(value: unknown, inheritedStatementId?: string): OpenUiQualityIssue[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => detectControlActionBindingConflicts(entry, inheritedStatementId));
  }

  if (!isElementNode(value)) {
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).flatMap((entry) => detectControlActionBindingConflicts(entry, inheritedStatementId));
    }

    return [];
  }

  const statementId = value.statementId ?? inheritedStatementId;
  const issues: OpenUiQualityIssue[] = [];

  if (
    value.props.action != null &&
    ((value.typeName === 'Checkbox' && isWritableBindingValue(value.props.checked)) ||
      ((value.typeName === 'RadioGroup' || value.typeName === 'Select') && isWritableBindingValue(value.props.value)))
  ) {
    issues.push(
      createOpenUiQualityIssue('blocking-quality', {
        code: 'control-action-and-binding',
        message:
          'Form-control cannot have both action and a writable $binding. Use $binding for form state, or action for persisted updates.',
        statementId,
      }),
    );
  }

  for (const nestedValue of Object.values(value.props)) {
    issues.push(...detectControlActionBindingConflicts(nestedValue, statementId));
  }

  return issues;
}

function hasStateRefNamed(value: unknown, stateName: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasStateRefNamed(entry, stateName));
  }

  if (isAstNode(value)) {
    if (value.k === 'StateRef' && value.n === stateName) {
      return true;
    }

    return Object.values(value).some((entry) => hasStateRefNamed(entry, stateName));
  }

  if (isElementNode(value)) {
    return Object.values(value.props).some((entry) => hasStateRefNamed(entry, stateName));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((entry) => hasStateRefNamed(entry, stateName));
  }

  return false;
}

function getItemScopedControlArgIndexes(typeName: string) {
  if (typeName === 'Checkbox') {
    return {
      action: 5,
      binding: 2,
      name: 0,
    };
  }

  if (typeName === 'Input' || typeName === 'TextArea') {
    return {
      action: null,
      binding: 2,
      name: 0,
    };
  }

  if (typeName === 'RadioGroup' || typeName === 'Select') {
    return {
      action: 6,
      binding: 2,
      name: 0,
    };
  }

  return null;
}

function sourceReferencesItemField(expressionSource: string, itemAlias: string) {
  if (!expressionSource.trim()) {
    return false;
  }

  return new RegExp(`(?<![\\w$])${escapeRegExp(itemAlias)}\\.[A-Za-z_][\\w-]*\\b`).test(maskStringLiterals(expressionSource));
}

function detectItemBoundControlsWithoutAction(source: string): OpenUiQualityIssue[] {
  const issues: OpenUiQualityIssue[] = [];
  const seenIssueKeys = new Set<string>();

  for (const eachCall of findFunctionCalls(source, 'Each')) {
    const collectionLabel = eachCall.args[0]?.trim() || 'the repeated collection';
    const itemAlias = parseStringLiteralValue(eachCall.args[1] ?? '') ?? 'item';
    const rowSource = eachCall.args[2] ?? '';

    for (const controlTypeName of ITEM_SCOPED_CONTROL_TYPE_NAMES) {
      const argIndexes = getItemScopedControlArgIndexes(controlTypeName);

      if (!argIndexes) {
        continue;
      }

      for (const controlCall of findFunctionCalls(rowSource, controlTypeName)) {
        const nameSource = controlCall.args[argIndexes.name] ?? '';
        const bindingSource = controlCall.args[argIndexes.binding] ?? '';
        const actionSource = argIndexes.action == null ? '' : (controlCall.args[argIndexes.action] ?? '');
        const hasAction = actionSource.trim() !== '' && actionSource.trim() !== 'null';

        if (
          hasAction ||
          (!sourceReferencesItemField(nameSource, itemAlias) && !sourceReferencesItemField(bindingSource, itemAlias))
        ) {
          continue;
        }

        const issueKey = `${controlTypeName}:${collectionLabel}:${controlCall.text}`;

        if (seenIssueKeys.has(issueKey)) {
          continue;
        }

        seenIssueKeys.add(issueKey);
        issues.push(
          createOpenUiQualityIssue('blocking-quality', {
            code: 'item-bound-control-without-action',
            message: `Item-scoped control without \`action\` will not persist changes back to \`${collectionLabel}\`. Use action-mode with \`toggle_item_field\` / \`update_item_field\`.`,
          }),
        );
      }
    }
  }

  return issues;
}

function createReservedLastChoiceIssue(statementId?: string): OpenUiQualityIssue {
  return createOpenUiQualityIssue('fatal-quality', {
    code: 'reserved-last-choice-outside-action-mode',
    message:
      '`$lastChoice` is reserved for Select/RadioGroup action mode. Use it only inside those Action([...]) flows or the top-level Mutation(...) / Query(...) statements they run.',
    statementId,
  });
}

function detectReservedLastChoiceRootIssues(
  value: unknown,
  inheritedStatementId?: string,
  allowLastChoice = false,
  seenIssueKeys: Set<string> = new Set(),
): OpenUiQualityIssue[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      detectReservedLastChoiceRootIssues(entry, inheritedStatementId, allowLastChoice, seenIssueKeys),
    );
  }

  if (isElementNode(value)) {
    const statementId = value.statementId ?? inheritedStatementId;
    const isActionModeChoiceComponent = ACTION_MODE_CHOICE_COMPONENT_NAMES.has(value.typeName) && value.props.action != null;

    return Object.entries(value.props).flatMap(([propName, propValue]) =>
      detectReservedLastChoiceRootIssues(
        propValue,
        statementId,
        propName === 'action' && isActionModeChoiceComponent,
        seenIssueKeys,
      ),
    );
  }

  if (isAstNode(value)) {
    if (value.k === 'StateRef' && value.n === ACTION_MODE_LAST_CHOICE_STATE && !allowLastChoice) {
      const issueKey = inheritedStatementId ?? 'root';

      if (seenIssueKeys.has(issueKey)) {
        return [];
      }

      seenIssueKeys.add(issueKey);
      return [createReservedLastChoiceIssue(inheritedStatementId)];
    }

    return Object.values(value).flatMap((entry) =>
      detectReservedLastChoiceRootIssues(entry, inheritedStatementId, allowLastChoice, seenIssueKeys),
    );
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap((entry) =>
      detectReservedLastChoiceRootIssues(entry, inheritedStatementId, allowLastChoice, seenIssueKeys),
    );
  }

  return [];
}

function detectReservedLastChoiceStatementIssues(source: string, result: ParseResult): OpenUiQualityIssue[] {
  const issues: OpenUiQualityIssue[] = [];
  const seenIssueKeys = new Set<string>();
  const actionGroups = collectOwnedActionRunRefGroups(result.root);
  const maskedSource = maskStringLiterals(source);
  const ownerTypesByStatementId = new Map<string, Set<string>>();
  const knownStatementIds = new Set<string>([
    'root',
    ...result.queryStatements.map((statement) => statement.statementId),
    ...result.mutationStatements.map((statement) => statement.statementId),
  ]);

  for (const actionGroup of actionGroups) {
    for (const runRef of actionGroup.runRefs) {
      const ownerTypes = ownerTypesByStatementId.get(runRef.statementId) ?? new Set<string>();

      if (typeof actionGroup.ownerTypeName === 'string') {
        ownerTypes.add(actionGroup.ownerTypeName);
      }

      ownerTypesByStatementId.set(runRef.statementId, ownerTypes);
    }
  }

  const statementsToCheck = [
    ...result.queryStatements.map((statement) => ({
      statementId: statement.statementId,
      value: [statement.toolAST, statement.argsAST, statement.defaultsAST, statement.refreshAST],
    })),
    ...result.mutationStatements.map((statement) => ({
      statementId: statement.statementId,
      value: [statement.toolAST, statement.argsAST],
    })),
  ];

  for (const statement of statementsToCheck) {
    if (!hasStateRefNamed(statement.value, ACTION_MODE_LAST_CHOICE_STATE)) {
      continue;
    }

    const ownerTypes = ownerTypesByStatementId.get(statement.statementId) ?? new Set<string>();
    const hasAllowedOwner = [...ownerTypes].some((ownerType) => ACTION_MODE_CHOICE_COMPONENT_NAMES.has(ownerType));
    const hasDisallowedOwner = [...ownerTypes].some((ownerType) => !ACTION_MODE_CHOICE_COMPONENT_NAMES.has(ownerType));

    if (hasAllowedOwner && !hasDisallowedOwner) {
      continue;
    }

    if (seenIssueKeys.has(statement.statementId)) {
      continue;
    }

    seenIssueKeys.add(statement.statementId);
    issues.push(createReservedLastChoiceIssue(statement.statementId));
  }

  const topLevelAssignmentPattern = /(^|\n)(\$?[A-Za-z_][\w$]*)\s*=\s*([\s\S]*?)(?=\n(?:\$?[A-Za-z_][\w$]*\s*=|root\s*=)|$)/g;
  let match = topLevelAssignmentPattern.exec(maskedSource);

  while (match) {
    const statementId = match[2];
    const statementValueSource = match[3] ?? '';

    if (
      !statementValueSource.includes(ACTION_MODE_LAST_CHOICE_STATE) ||
      knownStatementIds.has(statementId) ||
      seenIssueKeys.has(statementId)
    ) {
      match = topLevelAssignmentPattern.exec(maskedSource);
      continue;
    }

    seenIssueKeys.add(statementId);
    issues.push(createReservedLastChoiceIssue(statementId));
    match = topLevelAssignmentPattern.exec(maskedSource);
  }

  return issues;
}

function validateQueryTools(result: ParseResult): BuilderParseIssue[] {
  return result.queryStatements.flatMap((query) => {
    const toolName = extractStringLiteral(query.toolAST);

    if (!toolName) {
      return result.meta.incomplete
        ? []
        : [
            createParserIssue({
              code: 'invalid-tool-name',
              message: 'Query() tool names must be string literals.',
              statementId: query.statementId,
            }),
          ];
    }

    if (ALLOWED_TOOLS.has(toolName)) {
      return [];
    }

    return [
      createParserIssue({
        code: 'unknown-tool',
        message: `Tool "${toolName}" is not allowed.`,
        statementId: query.statementId,
      }),
    ];
  });
}

function validateMutationTools(result: ParseResult): BuilderParseIssue[] {
  return result.mutationStatements.flatMap((mutation) => {
    const toolName = extractStringLiteral(mutation.toolAST);

    if (!toolName) {
      return result.meta.incomplete
        ? []
        : [
            createParserIssue({
              code: 'invalid-tool-name',
              message: 'Mutation() tool names must be string literals.',
              statementId: mutation.statementId,
            }),
          ];
    }

    if (ALLOWED_TOOLS.has(toolName)) {
      return [];
    }

    return [
      createParserIssue({
        code: 'unknown-tool',
        message: `Tool "${toolName}" is not allowed.`,
        statementId: mutation.statementId,
      }),
    ];
  });
}

function isSimplePrompt(prompt: string) {
  return SIMPLE_PROMPT_INCLUDE_PATTERN.test(prompt) && !SIMPLE_PROMPT_EXCLUDE_PATTERN.test(prompt);
}

function promptRequestsTheme(prompt: string) {
  return THEME_REQUEST_PATTERN.test(prompt);
}

function promptRequestsTodo(prompt: string) {
  return promptMentionsTodoIntent(prompt);
}

function promptRequestsCompute(prompt: string) {
  return COMPUTE_REQUEST_PATTERN.test(prompt);
}

function promptRequestsFiltering(prompt: string) {
  return FILTER_REQUEST_PATTERN.test(prompt);
}

function promptRequestsValidation(prompt: string) {
  return VALIDATION_REQUEST_PATTERN.test(prompt);
}

function promptRequestsRandom(prompt: string) {
  return RANDOM_REQUEST_PATTERN.test(prompt);
}

function hasComputeTools(result: ParseResult) {
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

function hasRequiredTodoControls(result: ParseResult, source: string) {
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

function isAstNode(value: unknown): value is ExpressionAst {
  return typeof value === 'object' && value !== null && 'k' in value && typeof (value as { k?: unknown }).k === 'string';
}

function extractPathLiteral(argsAst: unknown) {
  if (!isAstNode(argsAst) || argsAst.k !== 'Obj' || !Array.isArray(argsAst.entries)) {
    return null;
  }

  const pathEntry = argsAst.entries.find(([key]) => key === 'path');
  const pathValue = pathEntry?.[1];

  return isAstNode(pathValue) && pathValue.k === 'Str' && typeof pathValue.v === 'string' ? pathValue.v : null;
}

function extractObjectStringLiteral(argsAst: unknown, key: string) {
  if (!isAstNode(argsAst) || argsAst.k !== 'Obj' || !Array.isArray(argsAst.entries)) {
    return null;
  }

  const entry = argsAst.entries.find(([entryKey]) => entryKey === key);
  const value = entry?.[1];

  return isAstNode(value) && value.k === 'Str' && typeof value.v === 'string' ? value.v : null;
}

function splitPersistedPath(path: string) {
  const segments = path.split('.');

  return segments.every((segment) => segment.length > 0) ? segments : [];
}

function pathUsesArrayIndexSegment(path: string) {
  const segments = splitPersistedPath(path);

  return segments.slice(1).some((segment) => /^\d+$/.test(segment));
}

function isPathPrefix(prefix: string[], value: string[]) {
  return prefix.length <= value.length && prefix.every((segment, index) => value[index] === segment);
}

function doPathsOverlapByPrefix(leftPath: string, rightPath: string) {
  const leftSegments = splitPersistedPath(leftPath);
  const rightSegments = splitPersistedPath(rightPath);

  if (leftSegments.length === 0 || rightSegments.length === 0) {
    return false;
  }

  return isPathPrefix(leftSegments, rightSegments) || isPathPrefix(rightSegments, leftSegments);
}

function collectPersistedQueryRefs(result: ParseResult) {
  return result.queryStatements.flatMap((query) => {
    const toolName = extractStringLiteral(query.toolAST);
    const path = extractPathLiteral(query.argsAST);

    if (toolName !== 'read_state' || !path) {
      return [];
    }

    return [
      {
        path,
        statementId: query.statementId,
      } satisfies PersistedPathStatementRef,
    ];
  });
}

function collectRefreshablePersistedMutationPaths(result: ParseResult) {
  const mutationPathByStatementId = new Map<string, string>();

  for (const mutation of result.mutationStatements) {
    const toolName = extractStringLiteral(mutation.toolAST);
    const path = extractPathLiteral(mutation.argsAST);

    if (!toolName || !path || !REFRESHABLE_PERSISTED_MUTATION_TOOL_NAMES.has(toolName)) {
      continue;
    }

    mutationPathByStatementId.set(mutation.statementId, path);
  }

  return mutationPathByStatementId;
}

function containsRuntimeRef(value: unknown, runtimeRefNames: Set<string>): boolean {
  if (runtimeRefNames.size === 0) {
    return false;
  }

  if (typeof value === 'string') {
    return runtimeRefNames.has(value);
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsRuntimeRef(entry, runtimeRefNames));
  }

  if (!isAstNode(value)) {
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some((entry) => containsRuntimeRef(entry, runtimeRefNames));
    }

    return false;
  }

  if (value.k === 'RuntimeRef' && typeof value.n === 'string' && runtimeRefNames.has(value.n)) {
    return true;
  }

  return Object.values(value).some((entry) => containsRuntimeRef(entry, runtimeRefNames));
}

function hasThemeDependentContainerAppearance(value: unknown, themeStateNames: Set<string>): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasThemeDependentContainerAppearance(entry, themeStateNames));
  }

  if (!isElementNode(value)) {
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some((entry) => hasThemeDependentContainerAppearance(entry, themeStateNames));
    }

    return false;
  }

  if (
    THEME_CONTAINER_TYPE_NAMES.has(value.typeName) &&
    value.props.appearance != null &&
    containsRuntimeRef(value.props.appearance, themeStateNames)
  ) {
    return true;
  }

  return Object.values(value.props).some((entry) => hasThemeDependentContainerAppearance(entry, themeStateNames));
}

function collectThemeAppearanceRefNames(source: string) {
  const themeRefNames = new Set(source.match(/\$[\w$]*theme\b/gi) ?? []);

  if (themeRefNames.size === 0) {
    return themeRefNames;
  }

  const topLevelAssignmentPattern = /(^|\n)([A-Za-z_][\w$]*)\s*=\s*([\s\S]*?)(?=\n(?:\$?[A-Za-z_][\w$]*\s*=|root\s*=)|$)/g;
  let match = topLevelAssignmentPattern.exec(source);

  while (match) {
    const statementId = match[2];
    const statementValueSource = match[3] ?? '';

    if (
      statementId !== 'root' &&
      [...themeRefNames].some((themeRefName) => statementValueSource.includes(themeRefName))
    ) {
      themeRefNames.add(statementId);
    }

    match = topLevelAssignmentPattern.exec(source);
  }

  return themeRefNames;
}

function stripQualityIssueSeverity(issue: OpenUiQualityIssue): BuilderParseIssue {
  return {
    code: issue.code,
    message: issue.message,
    source: issue.source,
    statementId: issue.statementId,
  };
}

function collectActionRunRefsFromActionAst(actionAst: unknown): ActionRunRef[] {
  const runRefs: ActionRunRef[] = [];

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (isAstNode(node)) {
      if (node.k === 'Comp' && node.name === 'Run') {
        const refNode = Array.isArray(node.args) ? node.args[0] : null;

        if (
          isAstNode(refNode) &&
          refNode.k === 'RuntimeRef' &&
          (refNode.refType === 'mutation' || refNode.refType === 'query') &&
          typeof refNode.n === 'string'
        ) {
          runRefs.push({
            refType: refNode.refType,
            statementId: refNode.n,
          });
        }
      }

      Object.values(node).forEach(visit);
      return;
    }

    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(visit);
    }
  }

  visit(actionAst);
  return runRefs;
}

function collectActionRunRefGroups(value: unknown): ActionRunRef[][] {
  const actionGroups: ActionRunRef[][] = [];

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (isElementNode(node)) {
      Object.values(node.props).forEach(visit);
      return;
    }

    if (isAstNode(node)) {
      if (node.k === 'Comp' && node.name === 'Action') {
        actionGroups.push(collectActionRunRefsFromActionAst(node));
      }

      Object.values(node).forEach(visit);
      return;
    }

    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(visit);
    }
  }

  visit(value);
  return actionGroups;
}

function collectOwnedActionRunRefGroups(value: unknown): OwnedActionRunRefGroup[] {
  const actionGroups: OwnedActionRunRefGroup[] = [];

  function visit(
    node: unknown,
    owner?: {
      statementId?: string;
      typeName: string;
    },
  ) {
    if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry, owner));
      return;
    }

    if (isElementNode(node)) {
      const nextOwner = {
        statementId: node.statementId ?? owner?.statementId,
        typeName: node.typeName,
      };

      Object.values(node.props).forEach((entry) => visit(entry, nextOwner));
      return;
    }

    if (isAstNode(node)) {
      if (node.k === 'Comp' && node.name === 'Action') {
        actionGroups.push({
          ownerStatementId: owner?.statementId,
          ownerTypeName: owner?.typeName,
          runRefs: collectActionRunRefsFromActionAst(node),
        });
      }

      Object.values(node).forEach((entry) => visit(entry, owner));
      return;
    }

    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach((entry) => visit(entry, owner));
    }
  }

  visit(value);
  return actionGroups;
}

function detectInlineToolCallIssues(result: ParseResult): BuilderParseIssue[] {
  if (result.meta.incomplete || !result.root) {
    return [];
  }

  const issues: BuilderParseIssue[] = [];
  const seenIssueKeys = new Set<string>();

  function pushIssue(
    code: 'inline-tool-in-each' | 'inline-tool-in-prop' | 'inline-tool-in-repeater',
    message: string,
    statementId?: string,
  ) {
    const issueKey = `${code}:${statementId ?? 'global'}`;

    if (seenIssueKeys.has(issueKey)) {
      return;
    }

    seenIssueKeys.add(issueKey);
    issues.push(
      createQualityIssue({
        code,
        message,
        statementId,
      }),
    );
  }

  function visit(node: unknown, inheritedStatementId?: string, location: 'each' | 'prop' | 'repeater' = 'prop') {
    if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry, inheritedStatementId, location));
      return;
    }

    if (isElementNode(node)) {
      const statementId = node.statementId ?? inheritedStatementId;

      for (const [propName, propValue] of Object.entries(node.props)) {
        visit(propValue, statementId, node.typeName === 'Repeater' && propName === 'children' ? 'repeater' : location);
      }

      return;
    }

    if (isAstNode(node)) {
      if (node.k === 'Comp' && typeof node.name === 'string') {
        if (RESERVED_INLINE_TOOL_CALL_NAMES.has(node.name)) {
          if (location === 'each') {
            pushIssue(
              'inline-tool-in-each',
              'Mutation(...) and Query(...) must be top-level statements. Move the tool call above @Each and reference it via @Run(...). Pass item context with @Set(...).',
              inheritedStatementId,
            );
            return;
          }

          if (location === 'repeater') {
            pushIssue(
              'inline-tool-in-repeater',
              'Mutation(...) and Query(...) must be top-level statements. Build Repeater rows from named refs instead of inline tool calls.',
              inheritedStatementId,
            );
            return;
          }

          pushIssue(
            'inline-tool-in-prop',
            'Mutation(...) and Query(...) must be top-level statements. Move the tool call into a named top-level statement and reference that ref from the component prop or Action.',
            inheritedStatementId,
          );
          return;
        }

        if (node.name === 'Each') {
          Object.values(node).forEach((entry) => visit(entry, inheritedStatementId, 'each'));
          return;
        }
      }

      Object.values(node).forEach((entry) => visit(entry, inheritedStatementId, location));
      return;
    }

    if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach((entry) => visit(entry, inheritedStatementId, location));
    }
  }

  visit(result.root);
  return issues;
}

function detectPersistedMutationRefreshWarnings(result: ParseResult): BuilderParseIssue[] {
  if (result.meta.incomplete || !result.root) {
    return [];
  }

  const mutationPathByStatementId = collectRefreshablePersistedMutationPaths(result);
  const persistedQueryRefs = collectPersistedQueryRefs(result);

  if (mutationPathByStatementId.size === 0 || persistedQueryRefs.length === 0) {
    return [];
  }

  const warnings: BuilderParseIssue[] = [];
  const seenWarningKeys = new Set<string>();

  for (const actionRunRefs of collectActionRunRefGroups(result.root)) {
    for (const [index, runRef] of actionRunRefs.entries()) {
      if (runRef.refType !== 'mutation') {
        continue;
      }

      const path = mutationPathByStatementId.get(runRef.statementId);
      const matchingQueryIds = path
        ? persistedQueryRefs.filter((queryRef) => doPathsOverlapByPrefix(path, queryRef.path)).map((queryRef) => queryRef.statementId)
        : [];
      const laterQueryRunIds = new Set(
        actionRunRefs.slice(index + 1).filter((ref) => ref.refType === 'query').map((ref) => ref.statementId),
      );

      if (!path || matchingQueryIds.length === 0 || matchingQueryIds.some((statementId) => laterQueryRunIds.has(statementId))) {
        continue;
      }

      const warningKey = `${runRef.statementId}:${path}`;

      if (seenWarningKeys.has(warningKey)) {
        continue;
      }

      seenWarningKeys.add(warningKey);
      warnings.push(
        createQualityIssue({
          code: 'quality-stale-persisted-query',
          message: `Persisted mutation may not refresh visible query. After @Run(${runRef.statementId}), also run ${matchingQueryIds
            .map((statementId) => `@Run(${statementId})`)
            .join(' or ')} later in the same Action for affected path "${path}".`,
          statementId: runRef.statementId,
        }),
      );
    }
  }

  return warnings;
}

function detectArrayIndexPathMutationIssues(result: ParseResult): OpenUiQualityIssue[] {
  return result.mutationStatements.flatMap((mutation) => {
    const toolName = extractStringLiteral(mutation.toolAST);
    const path = extractPathLiteral(mutation.argsAST);

    if (!toolName || !path || !ARRAY_INDEX_PATH_MUTATION_TOOL_NAMES.has(toolName) || !pathUsesArrayIndexSegment(path)) {
      return [];
    }

    return [
      createOpenUiQualityIssue('blocking-quality', {
        code: 'mutation-uses-array-index-path',
        message:
          'Mutating array elements by index is fragile. Use `toggle_item_field`, `update_item_field`, or `remove_item` with `idField`+`id`.',
        statementId: mutation.statementId,
      }),
    ];
  });
}

function detectRandomResultVisibilityIssues(result: ParseResult): BuilderParseIssue[] {
  if (result.meta.incomplete || !result.root) {
    return [];
  }

  const persistedQueryRefs = collectPersistedQueryRefs(result);
  const actionRunRefGroups = collectActionRunRefGroups(result.root);
  const randomMutations = result.mutationStatements.flatMap((mutation) => {
    const toolName = extractStringLiteral(mutation.toolAST);
    const path = extractPathLiteral(mutation.argsAST);
    const op = extractObjectStringLiteral(mutation.argsAST, 'op');

    if (toolName !== 'write_computed_state' || op !== 'random_int' || !path) {
      return [];
    }

    return [{ path, statementId: mutation.statementId } satisfies PersistedPathStatementRef];
  });

  for (const randomMutation of randomMutations) {
    const matchingQueryIds = persistedQueryRefs
      .filter((queryRef) => doPathsOverlapByPrefix(randomMutation.path, queryRef.path))
      .map((queryRef) => queryRef.statementId);

    if (matchingQueryIds.length === 0) {
      continue;
    }

    const hasVisibleRefreshAction = actionRunRefGroups.some((actionRunRefs) =>
      actionRunRefs.some(
        (runRef, index) =>
          runRef.refType === 'mutation' &&
          runRef.statementId === randomMutation.statementId &&
          actionRunRefs
            .slice(index + 1)
            .some((laterRunRef) => laterRunRef.refType === 'query' && matchingQueryIds.includes(laterRunRef.statementId)),
      ),
    );

    if (hasVisibleRefreshAction) {
      return [];
    }
  }

  return [
    createQualityIssue({
      code: 'quality-random-result-not-visible',
      message:
        'Random result cannot become visible. Use a `Mutation("write_computed_state", ...)`, a matching `Query("read_state", { path: "..." }, defaultValue)`, and a button `Action(...)` that runs both.',
    }),
  ];
}

function detectThemeAppearanceIssues(source: string, result: ParseResult): BuilderParseIssue[] {
  if (result.meta.incomplete || !result.root) {
    return [];
  }

  const themeStateNames = collectThemeAppearanceRefNames(source);

  if (themeStateNames.size > 0 && hasThemeDependentContainerAppearance(result.root, themeStateNames)) {
    return [];
  }

  return [
    createQualityIssue({
      code: 'quality-theme-state-not-applied',
      message:
        'Theme request did not wire theme state into container appearance. Bind AppShell or a top-level container appearance to a theme state such as `$currentTheme` so switching theme changes colors.',
    }),
  ];
}

export function detectOpenUiQualityIssues(source: string, userPrompt: string): OpenUiQualityIssue[] {
  const trimmedSource = typeof source === 'string' ? normalizeSourceForValidation(source) : '';
  const trimmedPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';

  if (!trimmedSource) {
    return [];
  }

  const result = parser.parse(trimmedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];
  const maskedSource = maskStringLiterals(trimmedSource);
  const metrics = collectQualityMetrics(result.root);
  const hasPromptContext = trimmedPrompt.length > 0;

  issues.push(...detectControlActionBindingConflicts(result.root));
  issues.push(...detectItemBoundControlsWithoutAction(trimmedSource));
  issues.push(...detectReservedLastChoiceRootIssues(result.root));
  issues.push(...detectReservedLastChoiceStatementIssues(trimmedSource, result));
  issues.push(...detectArrayIndexPathMutationIssues(result));

  if (hasPromptContext && isSimplePrompt(trimmedPrompt) && metrics.screenCount > 1) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-too-many-screens',
        message: 'Simple request generated multiple screens.',
      }),
    );
  }

  if (hasPromptContext && isSimplePrompt(trimmedPrompt) && metrics.blockGroupCount > MAX_SIMPLE_PROMPT_BLOCK_GROUPS) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-too-many-block-groups',
        message: 'Simple request generated many block groups. Consider fewer sections.',
      }),
    );
  }

  if (
    hasPromptContext &&
    !promptRequestsTheme(trimmedPrompt) &&
    (metrics.hasThemeStyling || /\$[\w$]*theme\b/i.test(maskedSource) || /\btheme\b/i.test(maskedSource))
  ) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-theme',
        message: 'Theme styling was added even though not requested.',
      }),
    );
  }

  if (hasPromptContext && !promptRequestsCompute(trimmedPrompt) && hasComputeTools(result)) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-compute',
        message: 'Compute tools were added even though not requested.',
      }),
    );
  }

  if (hasPromptContext && !promptRequestsFiltering(trimmedPrompt) && /@Filter\s*\(/.test(maskedSource)) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-filter',
        message: 'Filtering was added even though not requested.',
      }),
    );
  }

  if (hasPromptContext && !promptRequestsValidation(trimmedPrompt) && metrics.hasValidationRules) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-validation',
        message: 'Validation rules were added even though not requested.',
      }),
    );
  }

  if (hasPromptContext && promptRequestsTodo(trimmedPrompt) && !hasRequiredTodoControls(result, maskedSource)) {
    issues.push(
      createOpenUiQualityIssue(promptHasSimpleTodoIntent(trimmedPrompt) ? 'blocking-quality' : 'soft-warning', {
        code: 'quality-missing-todo-controls',
        message: 'Todo request did not generate required todo controls.',
      }),
    );
  }

  issues.push(
    ...detectInlineToolCallIssues(result).map((issue) => ({
      ...issue,
      severity: 'blocking-quality' as const,
    })),
  );

  issues.push(
    ...detectPersistedMutationRefreshWarnings(result).map((issue) => ({
      ...issue,
      severity: 'blocking-quality' as const,
    })),
  );

  if (hasPromptContext && promptRequestsRandom(trimmedPrompt)) {
    issues.push(
      ...detectRandomResultVisibilityIssues(result).map((issue) => ({
        ...issue,
        severity: 'blocking-quality' as const,
      })),
    );
  }

  if (hasPromptContext && promptRequestsTheme(trimmedPrompt)) {
    issues.push(
      ...detectThemeAppearanceIssues(trimmedSource, result).map((issue) => ({
        ...issue,
        severity: 'blocking-quality' as const,
      })),
    );
  }

  return issues;
}

export function detectOpenUiQualityWarnings(source: string, userPrompt: string): BuilderParseIssue[] {
  return detectOpenUiQualityIssues(source, userPrompt)
    .filter((issue) => issue.severity === 'soft-warning')
    .map(stripQualityIssueSeverity);
}

export function validateOpenUiSource(source: string): OpenUiValidationResult {
  const trimmedSource = typeof source === 'string' ? normalizeSourceForValidation(source) : '';

  if (!trimmedSource) {
    return {
      isValid: false,
      issues: [
        createParserIssue({
          code: 'empty-source',
          message: 'The model returned an empty OpenUI document.',
        }),
      ],
    };
  }

  if (trimmedSource.includes('```')) {
    return {
      isValid: false,
      issues: [
        createParserIssue({
          code: 'code-fence-present',
          message: 'Return raw OpenUI source without Markdown code fences.',
        }),
      ],
    };
  }

  const issues: BuilderParseIssue[] = [];

  if (trimmedSource.length > OPENUI_SOURCE_LIMITS.maxSourceChars) {
    issues.push(
      createParserIssue({
        code: 'source-too-large',
        message: `OpenUI source is too large. Max ${OPENUI_SOURCE_LIMITS.maxSourceChars} characters.`,
      }),
    );
  }

  for (const pattern of UNSAFE_SOURCE_PATTERNS) {
    if (!pattern.test(trimmedSource)) {
      continue;
    }

    issues.push(
      createParserIssue({
        code: 'unsafe-pattern',
        message: `Unsafe source pattern is not allowed: ${pattern}.`,
      }),
    );
  }

  const result = parser.parse(trimmedSource);
  issues.push(...mapParserIssues(result));

  if (result.meta.incomplete) {
    issues.push(
      createParserIssue({
        code: 'incomplete-source',
        message: 'The OpenUI source is incomplete or truncated.',
      }),
    );
  }

  issues.push(...validateLiteralProps(result.root));

  if (!result.meta.incomplete) {
    issues.push(
      ...result.meta.unresolved.map((statementId) =>
        createParserIssue({
          code: 'unresolved-reference',
          message: 'This statement was referenced but never defined in the final source.',
          statementId,
        }),
      ),
    );
  }

  if (!result.root) {
    issues.push(
      createParserIssue({
        code: 'missing-root',
        message: 'The final program does not define a renderable root = AppShell(...).',
      }),
    );
  }

  if (result.meta.statementCount > OPENUI_SOURCE_LIMITS.maxStatements) {
    issues.push(
      createParserIssue({
        code: 'too-many-statements',
        message: `OpenUI source has too many statements. Max ${OPENUI_SOURCE_LIMITS.maxStatements}.`,
      }),
    );
  }

  issues.push(...validateQueryTools(result));
  issues.push(...validateMutationTools(result));
  issues.push(...validateMutationReferenceUsage(trimmedSource, result));
  issues.push(...detectInlineToolCallIssues(result));

  const issuesWithSuggestions = appendAutoFixSuggestionIssues(trimmedSource, issues);

  return {
    isValid: issuesWithSuggestions.length === 0,
    issues: issuesWithSuggestions,
  };
}
