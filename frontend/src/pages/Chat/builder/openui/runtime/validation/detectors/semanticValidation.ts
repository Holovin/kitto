import type { ParseResult } from '@openuidev/react-lang';
import { parseSafeSourceUrlLiteral } from '@pages/Chat/builder/openui/runtime/safeUrl';
import {
  createOpenUiQualityIssue,
  extractStringLiteral,
  isAstNode,
  isElementNode,
  visitOpenUiValue,
  type BuilderQualityIssue,
  type OpenUiProgramIndex,
} from '@pages/Chat/builder/openui/runtime/validation/shared';

const COMPONENT_ID_TYPE_NAMES = new Set(['Input', 'TextArea', 'Checkbox', 'RadioGroup', 'Select']);
const CURRENT_SCREEN_REF_PATTERN = /^\$current[A-Za-z0-9_]*Screen[A-Za-z0-9_]*$/;

function pushDuplicateIssues({
  code,
  idByStatement,
  issues,
  messagePrefix,
}: {
  code: 'duplicate-button-id' | 'duplicate-component-id' | 'duplicate-screen-id';
  idByStatement: Array<{ id: string; statementId?: string; typeName: string }>;
  issues: BuilderQualityIssue[];
  messagePrefix: string;
}) {
  const refsById = new Map<string, Array<{ statementId?: string; typeName: string }>>();

  for (const ref of idByStatement) {
    const refs = refsById.get(ref.id) ?? [];
    refs.push({
      statementId: ref.statementId,
      typeName: ref.typeName,
    });
    refsById.set(ref.id, refs);
  }

  for (const [id, refs] of refsById) {
    if (refs.length < 2) {
      continue;
    }

    issues.push(
      createOpenUiQualityIssue('fatal-quality', {
        code,
        message: `${messagePrefix} "${id}" is used ${refs.length} times. Use stable unique ids for every generated component.`,
        statementId: refs[0]?.statementId ?? 'root',
      }),
    );
  }
}

function collectLiteralIdIssues(root: unknown): BuilderQualityIssue[] {
  const issues: BuilderQualityIssue[] = [];
  const screenIds: Array<{ id: string; statementId?: string; typeName: string }> = [];
  const buttonIds: Array<{ id: string; statementId?: string; typeName: string }> = [];
  const componentIds: Array<{ id: string; statementId?: string; typeName: string }> = [];

  visitOpenUiValue(root, (node, context) => {
    if (!isElementNode(node)) {
      return;
    }

    const rawId = node.typeName === 'Screen' || node.typeName === 'Button' ? node.props.id : node.props.name;

    if (typeof rawId !== 'string' || rawId.trim().length === 0) {
      return;
    }

    const ref = {
      id: rawId,
      statementId: context.statementId,
      typeName: node.typeName,
    };

    if (node.typeName === 'Screen') {
      screenIds.push(ref);
      return;
    }

    if (node.typeName === 'Button') {
      buttonIds.push(ref);
      return;
    }

    if (COMPONENT_ID_TYPE_NAMES.has(node.typeName)) {
      componentIds.push(ref);
    }
  });

  pushDuplicateIssues({
    code: 'duplicate-screen-id',
    idByStatement: screenIds,
    issues,
    messagePrefix: 'Screen id',
  });
  pushDuplicateIssues({
    code: 'duplicate-button-id',
    idByStatement: buttonIds,
    issues,
    messagePrefix: 'Button id',
  });
  pushDuplicateIssues({
    code: 'duplicate-component-id',
    idByStatement: componentIds,
    issues,
    messagePrefix: 'Component id',
  });

  return issues;
}

function collectScreenIds(root: unknown) {
  const screenIds = new Set<string>();

  visitOpenUiValue(root, (node) => {
    if (isElementNode(node) && node.typeName === 'Screen' && typeof node.props.id === 'string') {
      screenIds.add(node.props.id);
    }
  });

  return screenIds;
}

function isCurrentScreenStateRef(value: unknown) {
  return isAstNode(value) && value.k === 'StateRef' && typeof value.n === 'string' && CURRENT_SCREEN_REF_PATTERN.test(value.n);
}

function extractAstStringLiteral(value: unknown) {
  return isAstNode(value) && value.k === 'Str' && typeof value.v === 'string' ? value.v : null;
}

function collectActionSemanticIssues(root: unknown): BuilderQualityIssue[] {
  const issues: BuilderQualityIssue[] = [];
  const screenIds = collectScreenIds(root);
  const seenIssueKeys = new Set<string>();

  function pushUniqueIssue(issue: BuilderQualityIssue) {
    const key = `${issue.code}:${issue.statementId ?? 'root'}:${issue.message}`;

    if (seenIssueKeys.has(key)) {
      return;
    }

    seenIssueKeys.add(key);
    issues.push(issue);
  }

  visitOpenUiValue(root, (node, context) => {
    if (!isAstNode(node) || node.k !== 'Comp' || typeof node.name !== 'string') {
      return;
    }

    if (node.name === 'Set') {
      const targetRef = Array.isArray(node.args) ? node.args[0] : null;
      const targetValue = Array.isArray(node.args) ? extractAstStringLiteral(node.args[1]) : null;

      if (isCurrentScreenStateRef(targetRef) && targetValue && !screenIds.has(targetValue)) {
        pushUniqueIssue(
          createOpenUiQualityIssue('blocking-quality', {
            code: 'set-current-screen-missing-target',
            message: `@Set(${targetRef.n}, "${targetValue}") points to a Screen id that does not exist. Add Screen("${targetValue}", ...) or update the action target.`,
            statementId: context.statementId ?? 'root',
          }),
        );
      }
    }

    if (node.name === 'Run') {
      const runRef = Array.isArray(node.args) ? node.args[0] : null;
      const isKnownToolRef =
        isAstNode(runRef) &&
        runRef.k === 'RuntimeRef' &&
        (runRef.refType === 'query' || runRef.refType === 'mutation') &&
        typeof runRef.n === 'string';

      if (!isKnownToolRef) {
        pushUniqueIssue(
          createOpenUiQualityIssue('fatal-quality', {
            code: 'unknown-action-run-reference',
            message:
              '@Run(...) must reference a top-level Query or Mutation statement. Move the tool call to a named top-level statement and run that ref.',
            statementId: context.statementId ?? 'root',
          }),
        );
      }
    }

    if (node.name === 'OpenUrl') {
      const url = Array.isArray(node.args) ? extractAstStringLiteral(node.args[0]) : null;

      if (url && !parseSafeSourceUrlLiteral(url)) {
        pushUniqueIssue(
          createOpenUiQualityIssue('fatal-quality', {
            code: 'unsafe-url-literal',
            message: `@OpenUrl("${url}") uses a URL that is not allowed. Use a full https:// or http:// URL.`,
            statementId: context.statementId ?? 'root',
          }),
        );
      }
    }
  });

  return issues;
}

function collectToolReferenceIssues(result: ParseResult, programIndex: OpenUiProgramIndex): BuilderQualityIssue[] {
  const issues: BuilderQualityIssue[] = [];
  const queryIds = new Set(result.queryStatements.map((statement) => statement.statementId));
  const mutationIds = new Set(result.mutationStatements.map((statement) => statement.statementId));

  for (const actionGroup of programIndex.ownedActionRunRefGroups) {
    for (const runRef of actionGroup.runRefs) {
      if (runRef.refType === 'query' && !queryIds.has(runRef.statementId)) {
        issues.push(
          createOpenUiQualityIssue('fatal-quality', {
            code: 'unknown-query-reference',
            message: `@Run(${runRef.statementId}) is marked as a Query ref, but no matching Query statement exists.`,
            statementId: actionGroup.ownerStatementId ?? 'root',
          }),
        );
      }

      if (runRef.refType === 'mutation' && !mutationIds.has(runRef.statementId)) {
        issues.push(
          createOpenUiQualityIssue('fatal-quality', {
            code: 'unknown-mutation-reference',
            message: `@Run(${runRef.statementId}) is marked as a Mutation ref, but no matching Mutation statement exists.`,
            statementId: actionGroup.ownerStatementId ?? 'root',
          }),
        );
      }
    }
  }

  return issues;
}

function collectLinkUrlIssues(root: unknown): BuilderQualityIssue[] {
  const issues: BuilderQualityIssue[] = [];

  visitOpenUiValue(root, (node, context) => {
    if (!isElementNode(node) || node.typeName !== 'Link') {
      return;
    }

    const url = node.props.url;

    if (typeof url !== 'string' || parseSafeSourceUrlLiteral(url)) {
      return;
    }

    issues.push(
      createOpenUiQualityIssue('fatal-quality', {
        code: 'unsafe-url-literal',
        message: `Link URL "${url}" is not allowed. Use a full https:// or http:// URL.`,
        statementId: context.statementId ?? 'root',
      }),
    );
  });

  return issues;
}

function collectOrphanScreenIssues(result: ParseResult, programIndex: OpenUiProgramIndex): BuilderQualityIssue[] {
  const orphanedStatementIds = new Set(result.meta.orphaned);

  return programIndex.topLevelStatements.flatMap((statement) => {
    if (!orphanedStatementIds.has(statement.statementId) || !statement.rawValueSource.trimStart().startsWith('Screen(')) {
      return [];
    }

    return [
      createOpenUiQualityIssue('soft-warning', {
        code: 'orphan-screen',
        message: `Screen statement "${statement.statementId}" is not reachable from root = AppShell(...). Add it to AppShell children or remove it.`,
        statementId: statement.statementId,
      }),
    ];
  });
}

function collectNavigateScreenToolIssues(result: ParseResult, screenIds: Set<string>): BuilderQualityIssue[] {
  return result.mutationStatements.flatMap((mutation) => {
    const toolName = extractStringLiteral(mutation.toolAST);

    if (toolName !== 'navigate_screen') {
      return [];
    }

    const argsAst = mutation.argsAST;

    if (!isAstNode(argsAst) || argsAst.k !== 'Obj') {
      return [];
    }

    const targetEntry = argsAst.entries.find(([key]) => key === 'target' || key === 'screenId' || key === 'id');
    const target = targetEntry ? extractAstStringLiteral(targetEntry[1]) : null;

    if (!target || screenIds.has(target)) {
      return [];
    }

    return [
      createOpenUiQualityIssue('blocking-quality', {
        code: 'navigate-screen-missing-target',
        message: `navigate_screen target "${target}" does not match any Screen id in this app.`,
        statementId: mutation.statementId,
      }),
    ];
  });
}

export function detectSemanticValidationIssues(
  result: ParseResult,
  programIndex: OpenUiProgramIndex,
): BuilderQualityIssue[] {
  if (result.meta.incomplete || result.meta.errors.length > 0 || !result.root) {
    return [];
  }

  const screenIds = collectScreenIds(result.root);

  return [
    ...collectLiteralIdIssues(result.root),
    ...collectToolReferenceIssues(result, programIndex),
    ...collectActionSemanticIssues(result.root),
    ...collectLinkUrlIssues(result.root),
    ...collectNavigateScreenToolIssues(result, screenIds),
    ...collectOrphanScreenIssues(result, programIndex),
  ];
}
