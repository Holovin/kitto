import {
  createChoiceOptionsShapeExpressionValueParser,
  detectChoiceOptionsShapeIssues as detectSharedChoiceOptionsShapeIssues,
} from '@kitto-openui/shared/openuiQualityOptionsShape.js';
import {
  escapeStringLiteralBackticksForParser,
  parser,
  type OpenUiProgramIndex,
  type BuilderQualityIssue,
} from '@pages/Chat/builder/openui/runtime/validation/shared';

const parseExpressionValue = createChoiceOptionsShapeExpressionValueParser({
  normalizeSource: escapeStringLiteralBackticksForParser,
  parseSource: (source) => parser.parse(source),
});

export function detectChoiceOptionsShapeIssues(programIndex: OpenUiProgramIndex): BuilderQualityIssue[] {
  return detectSharedChoiceOptionsShapeIssues(programIndex.topLevelStatements, { parseExpressionValue });
}
