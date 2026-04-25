import { isAstNode, isElementNode, type OpenUiQualityMetrics } from './shared.js';

type OpenUiVisitContext = {
  statementId?: string;
};

export function visitOpenUiValue(
  value: unknown,
  visitor: (node: unknown, context: OpenUiVisitContext) => void,
  inheritedStatementId?: string,
) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      visitOpenUiValue(entry, visitor, inheritedStatementId);
    }

    return;
  }

  if (isElementNode(value)) {
    const statementId = value.statementId ?? inheritedStatementId;
    visitor(value, { statementId });

    for (const nestedValue of Object.values(value.props)) {
      visitOpenUiValue(nestedValue, visitor, statementId);
    }

    return;
  }

  if (isAstNode(value)) {
    visitor(value, { statementId: inheritedStatementId });

    for (const nestedValue of Object.values(value)) {
      visitOpenUiValue(nestedValue, visitor, inheritedStatementId);
    }

    return;
  }

  if (typeof value === 'object' && value !== null) {
    visitor(value, { statementId: inheritedStatementId });

    for (const nestedValue of Object.values(value)) {
      visitOpenUiValue(nestedValue, visitor, inheritedStatementId);
    }
  }
}

export function collectQualityMetrics(value: unknown): OpenUiQualityMetrics {
  const metrics: OpenUiQualityMetrics = {
    blockGroupCount: 0,
    hasFilterUsage: false,
    hasThemeStyling: false,
    hasValidationRules: false,
    screenCount: 0,
  };

  visitOpenUiValue(value, (node) => {
    if (isAstNode(node) && node.k === 'Comp' && node.name === 'Filter') {
      metrics.hasFilterUsage = true;
    }

    if (!isElementNode(node)) {
      return;
    }

    if (node.typeName === 'Screen') {
      metrics.screenCount += 1;
    }

    if (node.typeName === 'Group' && node.props.variant !== 'inline') {
      metrics.blockGroupCount += 1;
    }

    if (node.props.appearance != null) {
      metrics.hasThemeStyling = true;
    }

    if (Array.isArray(node.props.validation) ? node.props.validation.length > 0 : node.props.validation != null) {
      metrics.hasValidationRules = true;
    }
  });

  return metrics;
}
