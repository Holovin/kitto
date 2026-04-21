import type { ParseResult } from '@openuidev/react-lang';
import type { BuilderParseIssue } from '@features/builder/types';
import { RESERVED_INLINE_TOOL_CALL_NAMES, createQualityIssue, isAstNode, isElementNode } from '../shared';

export function detectInlineToolCallIssues(result: ParseResult): BuilderParseIssue[] {
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
