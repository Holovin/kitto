import {
  createChoiceOptionsShapeExpressionValueParser,
  detectChoiceOptionsShapeIssues as detectSharedChoiceOptionsShapeIssues,
} from '@kitto-openui/shared/openuiQualityOptionsShape.js';
import { parser, type OpenUiProgramIndex, type BuilderQualityIssue } from '#backend/prompts/openui/quality/shared.js';

const parseExpressionValue = createChoiceOptionsShapeExpressionValueParser({
  parseSource: (source) => parser.parse(source),
});

export function detectChoiceOptionsShapeIssues(programIndex: OpenUiProgramIndex): BuilderQualityIssue[] {
  return detectSharedChoiceOptionsShapeIssues(programIndex.topLevelStatements, { parseExpressionValue });
}
