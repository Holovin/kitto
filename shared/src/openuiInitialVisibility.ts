import type { BuilderQualityIssue } from './builderApiContract.js';
import {
  isAstNode,
  isElementNode,
  visitOpenUiValue,
  type OpenUiElementNode,
  type OpenUiParseResultLike,
} from './openuiAst.js';

type PrimitiveValue = boolean | number | string | null;

function isPrimitiveValue(value: unknown): value is PrimitiveValue {
  return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

function evaluatePrimitive(value: unknown, stateDeclarations: Record<string, unknown>): PrimitiveValue | undefined {
  if (isPrimitiveValue(value)) {
    return value;
  }

  if (!isAstNode(value)) {
    return undefined;
  }

  if (value.k === 'Str' || value.k === 'Num' || value.k === 'Bool') {
    return isPrimitiveValue(value.v) ? value.v : undefined;
  }

  if (value.k === 'Null') {
    return null;
  }

  if (value.k === 'StateRef' && typeof value.n === 'string') {
    const stateValue = stateDeclarations[value.n];
    return isPrimitiveValue(stateValue) ? stateValue : undefined;
  }

  return undefined;
}

function evaluateBoolean(value: unknown, stateDeclarations: Record<string, unknown>): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (!isAstNode(value)) {
    return undefined;
  }

  if (value.k === 'Bool') {
    return typeof value.v === 'boolean' ? value.v : undefined;
  }

  if (value.k === 'UnaryOp' && value.op === '!') {
    const operand = evaluateBoolean(value.operand, stateDeclarations);
    return typeof operand === 'boolean' ? !operand : undefined;
  }

  if (value.k === 'BinOp' && (value.op === '==' || value.op === '===' || value.op === '!=' || value.op === '!==')) {
    const leftValue = evaluatePrimitive(value.left, stateDeclarations);
    const rightValue = evaluatePrimitive(value.right, stateDeclarations);

    if (leftValue === undefined || rightValue === undefined) {
      return undefined;
    }

    const isEqual = leftValue === rightValue;
    return value.op === '!=' || value.op === '!==' ? !isEqual : isEqual;
  }

  return undefined;
}

function collectScreens(root: unknown) {
  const screens: OpenUiElementNode[] = [];

  visitOpenUiValue(root, (node) => {
    if (isElementNode(node) && node.typeName === 'Screen') {
      screens.push(node);
    }
  });

  return screens;
}

function hasVisibilityGate(screen: OpenUiElementNode) {
  return Object.prototype.hasOwnProperty.call(screen.props, 'isActive') && screen.props.isActive !== undefined;
}

export function detectPotentialEmptyInitialRenderIssues(
  result: Pick<OpenUiParseResultLike, 'root' | 'stateDeclarations'>,
): BuilderQualityIssue[] {
  if (!result.root) {
    return [];
  }

  const screens = collectScreens(result.root);

  if (screens.length === 0 || screens.some((screen) => !hasVisibilityGate(screen))) {
    return [];
  }

  const stateDeclarations = result.stateDeclarations ?? {};
  const hasInitiallyVisibleScreen = screens.some((screen) => evaluateBoolean(screen.props.isActive, stateDeclarations) === true);

  if (hasInitiallyVisibleScreen) {
    return [];
  }

  return [
    {
      code: 'quality-empty-initial-render',
      context: {
        screenCount: screens.length,
      },
      message:
        'All Screen sections are conditional, and none is obviously visible from the initial state. Set the initial step state to a visible section or leave an always-visible Screen without isActive.',
      severity: 'soft-warning',
      source: 'quality',
      statementId: screens[0]?.statementId ?? 'root',
    },
  ];
}
