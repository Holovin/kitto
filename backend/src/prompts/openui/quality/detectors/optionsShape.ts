import { detectChoiceOptionsShapeIssues as detectSharedChoiceOptionsShapeIssues } from '@kitto-openui/shared/openuiQualityOptionsShape.js';
import { isElementNode, parser, type OpenUiProgramIndex, type OpenUiQualityIssue } from '#backend/prompts/openui/quality/shared.js';

const PROBE_SOURCE_PREFIX = 'expr = ';
const PROBE_SOURCE_SUFFIX = `
root = AppShell([
  Screen("probe", "Probe", [
    Text(expr, "body", "start")
  ])
])`;

function parseExpressionValue(expressionSource: string) {
  const wrappedSource = `${PROBE_SOURCE_PREFIX}${expressionSource}${PROBE_SOURCE_SUFFIX}`;
  const result = parser.parse(wrappedSource);

  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return null;
  }

  const screenNode = Array.isArray(result.root.props.children) ? result.root.props.children[0] : null;

  if (!isElementNode(screenNode)) {
    return null;
  }

  const textNode = Array.isArray(screenNode.props.children) ? screenNode.props.children[0] : null;

  return isElementNode(textNode) ? textNode.props.value : null;
}

export function detectChoiceOptionsShapeIssues(programIndex: OpenUiProgramIndex): OpenUiQualityIssue[] {
  return detectSharedChoiceOptionsShapeIssues(programIndex.topLevelStatements, { parseExpressionValue });
}
