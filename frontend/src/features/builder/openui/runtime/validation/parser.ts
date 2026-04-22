import type { ParseResult } from '@openuidev/react-lang';
import { HEX_COLOR_PATTERN, inspectValidationConfig } from '@features/builder/openui/library/components/shared';
import type { BuilderParseIssue } from '@features/builder/types';
import { ALLOWED_TOOLS, OPENUI_SOURCE_LIMITS, UNSAFE_SOURCE_PATTERNS } from '@features/builder/openui/runtime/validationLimits';
import {
  componentSchemaDefinitions,
  createParserIssue,
  escapeRegExp,
  extractStringLiteral,
  isElementNode,
  isLiteralObjectValue,
  mapParserIssues,
  maskStringLiterals,
} from './shared';

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

export function collectOpenUiParserValidationIssues(source: string, result: ParseResult): BuilderParseIssue[] {
  const issues: BuilderParseIssue[] = [];

  if (source.length > OPENUI_SOURCE_LIMITS.maxSourceChars) {
    issues.push(
      createParserIssue({
        code: 'source-too-large',
        message: `OpenUI source is too large. Max ${OPENUI_SOURCE_LIMITS.maxSourceChars} characters.`,
      }),
    );
  }

  for (const pattern of UNSAFE_SOURCE_PATTERNS) {
    if (!pattern.test(source)) {
      continue;
    }

    issues.push(
      createParserIssue({
        code: 'unsafe-pattern',
        message: `Unsafe source pattern is not allowed: ${pattern}.`,
      }),
    );
  }

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
  issues.push(...validateMutationReferenceUsage(source, result));

  return issues;
}
