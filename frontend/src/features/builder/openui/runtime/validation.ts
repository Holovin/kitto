import { createParser, type ParseResult } from '@openuidev/react-lang';
import { builderOpenUiLibrary } from '@features/builder/openui/library';
import { HEX_COLOR_PATTERN, inspectValidationConfig } from '@features/builder/openui/library/components/shared';
import type { BuilderParseIssue } from '@features/builder/types';
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
const REFRESHABLE_PERSISTED_MUTATION_TOOL_NAMES = new Set([
  'append_state',
  'merge_state',
  'remove_state',
  'write_computed_state',
  'write_state',
]);

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

type PersistedPathStatementRef = {
  path: string;
  statementId: string;
};

export type OpenUiQualityIssueSeverity = 'blocking-quality' | 'fatal-quality' | 'soft-warning';

export interface OpenUiQualityIssue extends BuilderParseIssue {
  severity: OpenUiQualityIssueSeverity;
}

const THEME_CONTAINER_TYPE_NAMES = new Set(['AppShell', 'Group', 'Repeater', 'Screen']);

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
    hasMutationTool(result, 'append_state')
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

  if (!trimmedSource || !trimmedPrompt) {
    return [];
  }

  const result = parser.parse(trimmedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return [];
  }

  const issues: OpenUiQualityIssue[] = [];
  const maskedSource = maskStringLiterals(trimmedSource);
  const metrics = collectQualityMetrics(result.root);

  if (isSimplePrompt(trimmedPrompt) && metrics.screenCount > 1) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-too-many-screens',
        message: 'Simple request generated multiple screens.',
      }),
    );
  }

  if (isSimplePrompt(trimmedPrompt) && metrics.blockGroupCount > MAX_SIMPLE_PROMPT_BLOCK_GROUPS) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-too-many-block-groups',
        message: 'Simple request generated many block groups. Consider fewer sections.',
      }),
    );
  }

  if (!promptRequestsTheme(trimmedPrompt) && (metrics.hasThemeStyling || /\$[\w$]*theme\b/i.test(maskedSource) || /\btheme\b/i.test(maskedSource))) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-theme',
        message: 'Theme styling was added even though not requested.',
      }),
    );
  }

  if (!promptRequestsCompute(trimmedPrompt) && hasComputeTools(result)) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-compute',
        message: 'Compute tools were added even though not requested.',
      }),
    );
  }

  if (!promptRequestsFiltering(trimmedPrompt) && /@Filter\s*\(/.test(maskedSource)) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-filter',
        message: 'Filtering was added even though not requested.',
      }),
    );
  }

  if (!promptRequestsValidation(trimmedPrompt) && metrics.hasValidationRules) {
    issues.push(
      createOpenUiQualityIssue('soft-warning', {
        code: 'quality-unrequested-validation',
        message: 'Validation rules were added even though not requested.',
      }),
    );
  }

  if (promptRequestsTodo(trimmedPrompt) && !hasRequiredTodoControls(result, maskedSource)) {
    issues.push(
      createOpenUiQualityIssue(promptHasSimpleTodoIntent(trimmedPrompt) ? 'blocking-quality' : 'soft-warning', {
        code: 'quality-missing-todo-controls',
        message: 'Todo request did not generate required todo controls.',
      }),
    );
  }

  issues.push(
    ...detectPersistedMutationRefreshWarnings(result).map((issue) => ({
      ...issue,
      severity: 'blocking-quality' as const,
    })),
  );

  if (promptRequestsRandom(trimmedPrompt)) {
    issues.push(
      ...detectRandomResultVisibilityIssues(result).map((issue) => ({
        ...issue,
        severity: 'blocking-quality' as const,
      })),
    );
  }

  if (promptRequestsTheme(trimmedPrompt)) {
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

  return {
    isValid: issues.length === 0,
    issues,
  };
}
