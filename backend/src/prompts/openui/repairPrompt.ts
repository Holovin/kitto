import { MAX_REPAIR_VALIDATION_ISSUES } from '../../limits.js';
import { getRelevantRepairExemplars } from './exemplars.js';
import { BUTTON_APPEARANCE_RULE } from './rules.js';
import { COMPACT_STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT } from './summaryRules.js';
import type { PromptBuildValidationIssue } from './types.js';

type RepairIssueMode = 'mixed' | 'parser' | 'quality';
type RepairSectionKey = 'committedSource' | 'hints' | 'invalidSource' | 'issues' | 'userPrompt';

interface RepairIssueSummary {
  issue: PromptBuildValidationIssue;
  repeatCount: number;
}

interface UndefinedStateReferenceSummary {
  exampleInitializer: string | null;
  refName: string;
  repeatCount: number;
}

const REPAIR_PROMPT_TEMPLATE_MAX_CHARS = 16_384;
const UNDEFINED_STATE_REFERENCE_MESSAGE_PATTERN =
  /State reference `(\$[A-Za-z_][\w$]*)` is missing a top-level declaration with a literal initial value\.(?: For example, add `\$\w+ = ([^`]+)`\.)?/;
const RESERVED_LAST_CHOICE_CRITICAL_RULES = [
  'When RadioGroup or Select runs in action mode, the runtime writes the newly selected option to `$lastChoice` before the action runs.',
  'Use `$lastChoice` only inside Select/RadioGroup action-mode flows or the top-level Mutation(...) / Query(...) statements those actions run.',
  'Do not read `$lastChoice` directly in Text(...), disabled expressions, or unrelated statements.',
] as const;

const REPAIR_CORE_CRITICAL_RULES = [
  'Use only supported components and tools.',
  'Every @Run(ref) must reference a defined Query or Mutation.',
  'AppShell must be the single root statement; never nest AppShell and never define a second AppShell anywhere else in the source.',
] as const;

const REPAIR_LAYOUT_CRITICAL_RULES = [
  'AppShell signature is AppShell(children, appearance?).',
  'Screen signature is Screen(id, title, children, isActive?, appearance?).',
  'Screen never contains another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
  'Group signature is Group(title, direction, children, variant?, appearance?).',
  'The second Group argument is direction and must be "vertical" or "horizontal".',
  'If you pass a Group variant, place it in the optional fourth argument.',
  'Never put "block" or "inline" in the second Group argument.',
  'Repeater never contains another Repeater at any depth. Flatten nested list ideas or use Group inside the row template instead of nesting Repeaters.',
] as const;

const REPAIR_TOOL_AND_CONTROL_CRITICAL_RULES = [
  'Mutation(...) and Query(...) must be top-level statements. Never inline them inside @Each(...), Repeater(...), component props, or other expressions.',
  'RadioGroup and Select options must be arrays of { label, value } objects. Never use bare string or number arrays for options.',
  ...RESERVED_LAST_CHOICE_CRITICAL_RULES,
] as const;

const REPAIR_APPEARANCE_CRITICAL_RULES = [
  'Use appearance only as { mainColor?: "#RRGGBB", contrastColor?: "#RRGGBB" }.',
  'Text supports only appearance.contrastColor. Do not pass appearance.mainColor to Text.',
  BUTTON_APPEARANCE_RULE,
  'Never use CSS, className, style objects, named colors, rgb(), hsl(), var(), url(), or arbitrary layout styling.',
] as const;

const REPAIR_STATE_CRITICAL_RULES = [
  'Use $currentScreen + @Set for screen navigation.',
  'Declare every `$var` that appears anywhere in the program at the top with a literal initial value, even if the draft excerpt below is truncated.',
  'Button signature is Button(id, label, variant, action?, disabled?, appearance?).',
] as const;

function buildRepairPromptCriticalRules(structuredOutput: boolean) {
  const repairOutputRules = structuredOutput
    ? [`Place the full corrected OpenUI Lang program in \`source\`. ${COMPACT_STRUCTURED_OUTPUT_SUMMARY_REQUIREMENT}`]
    : ['Return only raw OpenUI Lang.', 'Return the full updated program.'];

  return [
    ...repairOutputRules,
    ...REPAIR_CORE_CRITICAL_RULES,
    ...REPAIR_LAYOUT_CRITICAL_RULES,
    ...REPAIR_TOOL_AND_CONTROL_CRITICAL_RULES,
    ...REPAIR_APPEARANCE_CRITICAL_RULES,
    ...REPAIR_STATE_CRITICAL_RULES,
  ] as const;
}

export const REPAIR_PROMPT_CRITICAL_RULES = buildRepairPromptCriticalRules(true);

const CONTROL_ACTION_AND_BINDING_REPAIR_HINT =
  'Repair hint: Pick one of: (a) keep `$binding` and remove `action`, OR (b) keep `action` and replace the writable `$binding<…>` with a display-only literal/`item.field`.';
const CONTROL_ACTION_AND_BINDING_LAST_CHOICE_REPAIR_HINT =
  'If a RadioGroup/Select repair removes `action`, also remove or rewrite any top-level Mutation(...) / Query(...) helpers that still reference `$lastChoice`. Otherwise the repaired draft will still fail quality checks.';
const REPAIR_BLOCKING_QUALITY_CODES = new Set([
  'control-action-and-binding',
  'inline-tool-in-each',
  'inline-tool-in-prop',
  'inline-tool-in-repeater',
  'item-bound-control-without-action',
  'mutation-uses-array-index-path',
  'quality-options-shape',
  'quality-stale-persisted-query',
  'reserved-last-choice-outside-action-mode',
  'undefined-state-reference',
]);

type RepairPromptIssue = PromptBuildValidationIssue & {
  severity?: 'blocking-quality' | 'fatal-quality' | 'soft-warning';
};

function addUniqueLine(lines: string[], seenLines: Set<string>, line: string) {
  if (seenLines.has(line)) {
    return;
  }

  seenLines.add(line);
  lines.push(line);
}

function formatValidationIssue(summary: RepairIssueSummary) {
  const { issue, repeatCount } = summary;
  const repeatedSuffix = repeatCount > 1 ? ` [reported ${repeatCount} times]` : '';
  return `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}: ${issue.message}${repeatedSuffix}`;
}

function truncateText(value: string, maxChars: number) {
  if (maxChars <= 0) {
    return '';
  }

  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function buildRepairSection(title: string, content: string) {
  return `${title}:\n${content}`;
}

function formatRepairExemplarLines(exemplars: ReturnType<typeof getRelevantRepairExemplars>) {
  return exemplars.map((exemplar) =>
    [`- Example for ${exemplar.title.toLowerCase()}:`, ...exemplar.text.split('\n').map((line) => `  ${line}`)].join('\n'),
  );
}

function buildRepairSourceSectionContent(value: string, maxChars: number, fallback: string) {
  if (maxChars <= 0) {
    return truncateText(fallback, maxChars);
  }

  return value.trim() ? truncateText(value, maxChars) : truncateText(fallback, maxChars);
}

function buildBoundedSectionContent(lines: string[], maxChars: number, fallback: string) {
  if (maxChars <= 0) {
    return truncateText(fallback, maxChars);
  }

  if (!lines.length) {
    return truncateText(fallback, maxChars);
  }

  const selectedLines: string[] = [];

  for (const line of lines) {
    const candidateSection = [...selectedLines, line].join('\n');

    if (candidateSection.length > maxChars) {
      const currentLength = selectedLines.join('\n').length;
      const remainingChars = maxChars - currentLength - (selectedLines.length > 0 ? 1 : 0);

      if (remainingChars > 0) {
        selectedLines.push(truncateText(line, remainingChars));
      }

      break;
    }

    selectedLines.push(line);
  }

  return selectedLines.length ? selectedLines.join('\n') : truncateText(lines[0] ?? fallback, maxChars);
}

function parseUndefinedStateReferenceIssue(issue: PromptBuildValidationIssue) {
  if (issue.code !== 'undefined-state-reference') {
    return null;
  }

  const match = issue.message.match(UNDEFINED_STATE_REFERENCE_MESSAGE_PATTERN);

  if (!match?.[1]) {
    return null;
  }

  return {
    exampleInitializer: match[2] ?? null,
    refName: match[1],
  };
}

function summarizeUndefinedStateReferenceIssues(issues: PromptBuildValidationIssue[]) {
  const summaries: UndefinedStateReferenceSummary[] = [];
  const indexesByRefName = new Map<string, number>();

  for (const issue of issues) {
    const parsedIssue = parseUndefinedStateReferenceIssue(issue);

    if (!parsedIssue) {
      continue;
    }

    const existingIndex = indexesByRefName.get(parsedIssue.refName);

    if (existingIndex != null) {
      const existingSummary = summaries[existingIndex];

      if (!existingSummary) {
        continue;
      }

      existingSummary.repeatCount += 1;

      if (!existingSummary.exampleInitializer && parsedIssue.exampleInitializer) {
        existingSummary.exampleInitializer = parsedIssue.exampleInitializer;
      }

      continue;
    }

    indexesByRefName.set(parsedIssue.refName, summaries.length);
    summaries.push({
      exampleInitializer: parsedIssue.exampleInitializer,
      refName: parsedIssue.refName,
      repeatCount: 1,
    });
  }

  return summaries;
}

function summarizeRepairIssues(issues: PromptBuildValidationIssue[]) {
  const summaries: RepairIssueSummary[] = [];
  const undefinedStateIssueIndexes = new Map<string, number>();

  for (const issue of issues) {
    const parsedUndefinedStateIssue = parseUndefinedStateReferenceIssue(issue);

    if (parsedUndefinedStateIssue) {
      const existingIndex = undefinedStateIssueIndexes.get(parsedUndefinedStateIssue.refName);

      if (existingIndex != null) {
        const existingSummary = summaries[existingIndex];

        if (existingSummary) {
          existingSummary.repeatCount += 1;
        }

        continue;
      }

      undefinedStateIssueIndexes.set(parsedUndefinedStateIssue.refName, summaries.length);
    }

    summaries.push({
      issue,
      repeatCount: 1,
    });
  }

  return summaries;
}

function getRepairIssuePriority(issue: RepairPromptIssue) {
  if (issue.source === 'parser' && issue.code !== 'unresolved-reference') {
    return 0;
  }

  if (issue.severity === 'blocking-quality' || REPAIR_BLOCKING_QUALITY_CODES.has(issue.code)) {
    return 1;
  }

  return 2;
}

function sanitizeRepairPromptIssues(issues: PromptBuildValidationIssue[]) {
  return issues
    .map((issue, index) => ({
      index,
      issue,
      priority: getRepairIssuePriority(issue as RepairPromptIssue),
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .slice(0, MAX_REPAIR_VALIDATION_ISSUES)
    .map(({ issue }) => issue);
}

function allocateRepairSectionBudgets(
  totalChars: number,
  desiredLengths: Record<RepairSectionKey, number>,
  hasHints: boolean,
) {
  const priority: RepairSectionKey[] = ['hints', 'issues', 'userPrompt', 'committedSource', 'invalidSource'];
  const minimumBudgets: Record<RepairSectionKey, number> = {
    userPrompt: 120,
    committedSource: 180,
    invalidSource: 160,
    issues: 300,
    hints: hasHints ? 520 : 0,
  };
  const budgets: Record<RepairSectionKey, number> = {
    userPrompt: 0,
    committedSource: 0,
    invalidSource: 0,
    issues: 0,
    hints: 0,
  };

  if (totalChars <= 0) {
    return budgets;
  }

  const cappedMinimums: Record<RepairSectionKey, number> = {
    userPrompt: Math.min(desiredLengths.userPrompt, minimumBudgets.userPrompt),
    committedSource: Math.min(desiredLengths.committedSource, minimumBudgets.committedSource),
    invalidSource: Math.min(desiredLengths.invalidSource, minimumBudgets.invalidSource),
    issues: Math.min(desiredLengths.issues, minimumBudgets.issues),
    hints: Math.min(desiredLengths.hints, minimumBudgets.hints),
  };
  const minimumTotal = priority.reduce((sum, key) => sum + cappedMinimums[key], 0);
  let remainingChars = totalChars;

  if (remainingChars <= minimumTotal) {
    if (hasHints) {
      const issueBudget = Math.min(cappedMinimums.issues, Math.floor(remainingChars * 0.1));
      const draftBudget = Math.min(cappedMinimums.invalidSource, Math.max(0, remainingChars - issueBudget) > 0 ? 1 : 0);
      const hintBudget = Math.min(cappedMinimums.hints, remainingChars - issueBudget - draftBudget);

      budgets.issues = issueBudget;
      budgets.hints = hintBudget;
      budgets.invalidSource = draftBudget;
      remainingChars -= issueBudget + hintBudget + draftBudget;

      for (const key of priority.filter((candidate) => candidate !== 'issues' && candidate !== 'hints' && candidate !== 'invalidSource')) {
        if (remainingChars <= 0) {
          break;
        }

        const allocation = Math.min(cappedMinimums[key], remainingChars);
        budgets[key] = allocation;
        remainingChars -= allocation;
      }

      return budgets;
    }

    for (const key of priority) {
      if (remainingChars <= 0) {
        break;
      }

      const allocation = Math.min(cappedMinimums[key], remainingChars);
      budgets[key] = allocation;
      remainingChars -= allocation;
    }

    return budgets;
  }

  for (const key of priority) {
    budgets[key] = cappedMinimums[key];
    remainingChars -= cappedMinimums[key];
  }

  for (const key of priority) {
    if (remainingChars <= 0) {
      return budgets;
    }

    const additionalBudget = Math.min(desiredLengths[key] - budgets[key], remainingChars);

    if (additionalBudget <= 0) {
      continue;
    }

    budgets[key] += additionalBudget;
    remainingChars -= additionalBudget;
  }

  return budgets;
}

function buildRepairIssueSection(issues: PromptBuildValidationIssue[], maxChars: number) {
  const inlineHintLines = [
    ...new Set(
      issues
        .filter((issue) => issue.code === 'control-action-and-binding')
        .map(() => `- ${CONTROL_ACTION_AND_BINDING_REPAIR_HINT}`),
    ),
  ];
  const issueLines = summarizeRepairIssues(issues).map((summary) => `- ${formatValidationIssue(summary)}`);

  return buildBoundedSectionContent(
    [...issueLines, ...inlineHintLines],
    maxChars,
    '- Validation issues were detected, but they could not be enumerated in full.',
  );
}

function hasChoiceActionModeLastChoiceSource(source: string) {
  return source.includes('$lastChoice') && (source.includes('Select(') || source.includes('RadioGroup('));
}

function buildRepairHints(issues: PromptBuildValidationIssue[], invalidSource: string) {
  const hints: string[] = [];
  const seenHints = new Set<string>();
  const undefinedStateReferenceSummaries = summarizeUndefinedStateReferenceIssues(issues);
  const hasChoiceActionModeLastChoice = hasChoiceActionModeLastChoiceSource(invalidSource);

  for (const issue of issues) {
    if (issue.code === 'app-shell-not-root' || issue.code === 'multiple-app-shells') {
      addUniqueLine(
        hints,
        seenHints,
        'AppShell must be the single root statement; never nest AppShell and never define a second AppShell anywhere else in the source.',
      );
      continue;
    }

    if (issue.code === 'screen-inside-screen') {
      addUniqueLine(
        hints,
        seenHints,
        'Screen never contains another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
      );
      continue;
    }

    if (issue.code === 'repeater-inside-repeater') {
      addUniqueLine(
        hints,
        seenHints,
        'Repeater never contains another Repeater at any depth. Flatten nested list ideas or use Group inside the row template instead of nesting Repeaters.',
      );
      continue;
    }

    if (issue.code === 'inline-tool-in-each' || issue.code === 'inline-tool-in-prop' || issue.code === 'inline-tool-in-repeater') {
      addUniqueLine(
        hints,
        seenHints,
        'Mutation(...) and Query(...) must be top-level statements. Never inline them inside @Each(...), Repeater(...), component props, or other expressions.',
      );
      continue;
    }

    if (issue.code === 'quality-options-shape') {
      addUniqueLine(
        hints,
        seenHints,
        'Wrap each option in `{ label: "...", value: "..." }`.',
      );
      continue;
    }

    if (issue.code === 'control-action-and-binding') {
      if (hasChoiceActionModeLastChoice) {
        addUniqueLine(hints, seenHints, CONTROL_ACTION_AND_BINDING_LAST_CHOICE_REPAIR_HINT);
      }

      continue;
    }

    if (issue.code === 'invalid-prop') {
      addUniqueLine(hints, seenHints, 'Check component argument order against the documented signature before returning.');

      if (issue.message.includes('Group.direction')) {
        addUniqueLine(hints, seenHints, 'For Group(...), the second argument is direction and must be "vertical" or "horizontal".');
        addUniqueLine(hints, seenHints, 'If you need Group variant "block" or "inline", place it in the optional fourth argument.');
        addUniqueLine(hints, seenHints, 'Never put "block" or "inline" in the second Group argument.');
      }

      if (issue.message.includes('Group.variant')) {
        addUniqueLine(hints, seenHints, 'Group variant accepts only "block" or "inline" and belongs in the optional fourth argument.');
      }

      if (issue.message.includes('.appearance.') || issue.message.includes('.color') || issue.message.includes('.background')) {
        addUniqueLine(
          hints,
          seenHints,
          'Use appearance.mainColor and appearance.contrastColor only as six-character #RRGGBB hex strings such as "#111827" or "#F9FAFB".',
        );
        addUniqueLine(
          hints,
          seenHints,
          'Use appearance only with mainColor and contrastColor keys. Do not use textColor, bgColor, or color/background prop names.',
        );
        addUniqueLine(hints, seenHints, 'Do not use named colors, rgb(), hsl(), var(), url(), CSS objects, or className/style props.');
        addUniqueLine(hints, seenHints, BUTTON_APPEARANCE_RULE);
      }

      if (
        issue.message.includes('Text.appearance.mainColor') ||
        issue.message.includes('Text.appearance.textColor') ||
        issue.message.includes('Text.appearance.bgColor') ||
        issue.message.includes('Text.background')
      ) {
        addUniqueLine(
          hints,
          seenHints,
          'Text supports only appearance.contrastColor. If you need a colored surface, use Group, Screen, Repeater, or the control component appearance instead.',
        );
      }

      if (issue.message.includes('Screen.appearance') || issue.message.includes('Screen.color') || issue.message.includes('Screen.background')) {
        addUniqueLine(
          hints,
          seenHints,
          'Screen appearance belongs in the optional fifth argument: Screen(id, title, children, isActive?, appearance?).',
        );
      }

      continue;
    }

    if (issue.code === 'quality-stale-persisted-query') {
      const referencedRuns = [...issue.message.matchAll(/@Run\(([^)]+)\)/g)].map((match) => match[1]);
      const suggestedQueryRuns = referencedRuns.filter((statementId) => statementId !== issue.statementId);

      if (issue.statementId && suggestedQueryRuns.length > 0) {
        addUniqueLine(
          hints,
          seenHints,
          `The mutation updates persisted state used by visible UI, but the action does not re-run the query that reads it. Add ${suggestedQueryRuns
            .map((statementId) => `@Run(${statementId})`)
            .join(' or ')} later in the same Action after @Run(${issue.statementId}).`,
        );
      } else {
        addUniqueLine(
          hints,
          seenHints,
          'If a mutation updates persisted state that visible UI reads, re-run a matching Query("read_state", ...) later in the same Action.',
        );
      }

      addUniqueLine(
        hints,
        seenHints,
        'A matching persisted query can read the same path, a parent path, or a child path of the mutation path. Other steps such as @Reset(...) or @Set(...) may stay in the Action.',
      );
      continue;
    }

    if (issue.code === 'quality-missing-todo-controls') {
      addUniqueLine(
        hints,
        seenHints,
        'For a todo request, include an input for the draft value, a persisted `Query("read_state", ...)`, an `append_item` mutation for plain-object todo rows, a button action that runs the mutation and then the query, and a repeated list rendered through `@Each(...)` + `Repeater(...)`.',
      );
      continue;
    }

    if (issue.code === 'quality-random-result-not-visible') {
      addUniqueLine(
        hints,
        seenHints,
        'For button-triggered randomness, use the canonical persisted recipe: `Mutation("write_computed_state", { op: "random_int", ... })`, `Query("read_state", { path: "..." }, defaultValue)`, and a button `Action(...)` that runs both in order.',
      );
      continue;
    }

    if (issue.code === 'quality-theme-state-not-applied') {
      addUniqueLine(
        hints,
        seenHints,
        'When the user asks to switch or toggle between themes, introduce a theme state such as `$currentTheme`, derive a theme object from it, and bind `appearance` on `AppShell` or another top-level container to that derived theme.',
      );
    }
  }

  if (undefinedStateReferenceSummaries.length > 0) {
    addUniqueLine(
      hints,
      seenHints,
      'Add every missing `$var` before root.',
    );
    addUniqueLine(
      hints,
      seenHints,
      `Add: ${undefinedStateReferenceSummaries
        .map(({ exampleInitializer, refName }) => `\`${refName} = ${exampleInitializer ?? '""'}\``)
        .join(', ')}.`,
    );
  }

  return hints;
}

function getRepairIssueMode(issues: PromptBuildValidationIssue[]): RepairIssueMode {
  const hasQualityIssues = issues.some((issue) => issue.source === 'quality');
  const hasNonQualityIssues = issues.some((issue) => issue.source !== 'quality');

  if (hasQualityIssues && hasNonQualityIssues) {
    return 'mixed';
  }

  return hasQualityIssues ? 'quality' : 'parser';
}

function buildRepairIntroSection(
  mode: RepairIssueMode,
  attemptNumber: number,
  maxRepairAttempts: number,
  hasUndefinedStateReferenceIssues: boolean,
) {
  const introLines = [
    `The previous OpenUI draft cannot be committed yet. Automatic repair attempt ${attemptNumber} of ${maxRepairAttempts}.`,
  ];

  if (hasUndefinedStateReferenceIssues) {
    introLines.push(
      'The draft excerpt below may be truncated. Fix every listed missing `$var` declaration even when some references are not visible in the excerpt.',
    );
  }

  if (mode === 'quality') {
    introLines.push('The draft is syntactically valid but fails a product-quality check.');
    introLines.push('Use the current committed valid OpenUI source only as fallback context.');
    introLines.push('Stay close to the model draft below and fix only the listed quality issues with the smallest possible diff.');
    introLines.push('Do not rewrite unrelated parts, change unflagged behavior, or introduce new features.');
    introLines.push('Return a complete corrected program.');

    return introLines.join('\n');
  }

  if (mode === 'mixed') {
    introLines.push('The draft has validation issues and product-quality issues.');
    introLines.push('Use the current committed valid OpenUI source as the baseline for this request.');
    introLines.push('Stay close to the model draft below where possible, and fix only the listed issues.');
    introLines.push('Do not rewrite unrelated parts or introduce new features.');
    introLines.push('Return a complete corrected program.');

    return introLines.join('\n');
  }

  introLines.push('Use the current committed valid OpenUI source as the baseline for this request.');
  introLines.push('Carry forward the intended changes from the invalid model draft only when they can be expressed as valid OpenUI.');
  introLines.push('Fix every issue below and return a complete corrected program.');

  return introLines.join('\n');
}

function getRepairDraftSectionTitle(mode: RepairIssueMode) {
  return mode === 'parser' ? 'Invalid model draft' : 'Model draft to repair';
}

function getRepairDraftSectionFallback(mode: RepairIssueMode) {
  return mode === 'parser' ? '(the invalid draft was empty)' : '(the draft to repair was empty)';
}

function getRepairIssuesSectionTitle(mode: RepairIssueMode) {
  if (mode === 'quality') {
    return 'Quality issues';
  }

  if (mode === 'mixed') {
    return 'Validation and quality issues';
  }

  return 'Validation issues';
}

interface BuildOpenUiRepairPromptArgs {
  attemptNumber: number;
  committedSource: string;
  invalidSource: string;
  issues: PromptBuildValidationIssue[];
  maxRepairAttempts: number;
  promptMaxChars: number;
  structuredOutput?: boolean;
  userPrompt: string;
}

export function buildOpenUiRepairPrompt(args: BuildOpenUiRepairPromptArgs) {
  const { attemptNumber, committedSource, invalidSource, issues, maxRepairAttempts, promptMaxChars, userPrompt } = args;
  const structuredOutput = args.structuredOutput ?? true;
  const sanitizedIssues = sanitizeRepairPromptIssues(issues);
  const issueMode = getRepairIssueMode(sanitizedIssues);
  const repairHints = buildRepairHints(sanitizedIssues, invalidSource);
  const repairExemplars = getRelevantRepairExemplars(sanitizedIssues);
  const hasUndefinedStateReferenceIssues = sanitizedIssues.some((issue) => issue.code === 'undefined-state-reference');
  const introSection = buildRepairIntroSection(issueMode, attemptNumber, maxRepairAttempts, hasUndefinedStateReferenceIssues);
  const draftSectionTitle = getRepairDraftSectionTitle(issueMode);
  const draftSectionFallback = getRepairDraftSectionFallback(issueMode);
  const issuesSectionTitle = getRepairIssuesSectionTitle(issueMode);
  const rulesSection = buildRepairPromptCriticalRules(structuredOutput)
    .map((rule) => `- ${rule}`)
    .join('\n');
  const fullIssuesSectionContent = buildRepairIssueSection(sanitizedIssues, Number.MAX_SAFE_INTEGER);
  const fullHintsSectionContent = buildBoundedSectionContent(
    [...repairHints.map((hint) => `- ${hint}`), ...formatRepairExemplarLines(repairExemplars)],
    Number.MAX_SAFE_INTEGER,
    '- No targeted repair hints were available.',
  );
  const sectionSkeleton = [
    introSection,
    buildRepairSection('Original user request', ''),
    buildRepairSection('Current committed valid OpenUI source', ''),
    buildRepairSection(issuesSectionTitle, ''),
    repairHints.length > 0 || repairExemplars.length > 0 ? buildRepairSection('Targeted repair hints', '') : null,
    buildRepairSection(draftSectionTitle, ''),
    buildRepairSection('Current critical syntax rules', rulesSection),
  ]
    .filter(Boolean)
    .join('\n\n');
  const budgets = allocateRepairSectionBudgets(promptMaxChars - sectionSkeleton.length, {
    userPrompt: (userPrompt.trim() ? userPrompt : '(empty user request)').length,
    committedSource: (committedSource.trim() ? committedSource : '(blank canvas, no committed OpenUI source yet)').length,
    invalidSource: (invalidSource.trim() ? invalidSource : draftSectionFallback).length,
    issues: fullIssuesSectionContent.length,
    hints: repairHints.length > 0 || repairExemplars.length > 0 ? fullHintsSectionContent.length : 0,
  }, repairHints.length > 0 || repairExemplars.length > 0);
  const userRequestSectionContent = buildRepairSourceSectionContent(userPrompt, budgets.userPrompt, '(empty user request)');
  const committedSourceSectionContent = buildRepairSourceSectionContent(
    committedSource,
    budgets.committedSource,
    '(blank canvas, no committed OpenUI source yet)',
  );
  const issuesSectionContent = buildRepairIssueSection(sanitizedIssues, budgets.issues);
  const hintsSectionContent =
    repairHints.length > 0 || repairExemplars.length > 0
      ? buildBoundedSectionContent(
          [...repairHints.map((hint) => `- ${hint}`), ...formatRepairExemplarLines(repairExemplars)],
          budgets.hints,
          '- No targeted repair hints were available.',
        )
      : '';
  const draftSectionContent = buildRepairSourceSectionContent(invalidSource, budgets.invalidSource, draftSectionFallback);

  return truncateText(
    [
      introSection,
      buildRepairSection('Original user request', userRequestSectionContent),
      buildRepairSection('Current committed valid OpenUI source', committedSourceSectionContent),
      buildRepairSection(issuesSectionTitle, issuesSectionContent),
      repairHints.length > 0 || repairExemplars.length > 0 ? buildRepairSection('Targeted repair hints', hintsSectionContent) : null,
      buildRepairSection(draftSectionTitle, draftSectionContent),
      buildRepairSection('Current critical syntax rules', rulesSection),
    ]
      .filter(Boolean)
      .join('\n\n'),
    promptMaxChars,
  );
}

export function buildOpenUiRepairPromptTemplate(maxRepairAttempts: number, options: { structuredOutput?: boolean } = {}) {
  const structuredOutput = options.structuredOutput ?? true;
  const parserExampleIssues: PromptBuildValidationIssue[] = [
    {
      code: 'invalid-prop',
      message: 'Group.direction must be one of "vertical", "horizontal".',
      source: 'parser',
      statementId: 'root',
    },
  ];
  const qualityExampleIssues: PromptBuildValidationIssue[] = [
    {
      code: 'quality-stale-persisted-query',
      message:
        'Persisted mutation may not refresh visible query. After @Run(addItem), also run @Run(items) later in the same Action for affected path "app.items".',
      source: 'quality',
      statementId: 'addItem',
    },
  ];
  const mixedExampleIssues = [...parserExampleIssues, ...qualityExampleIssues];

  const buildTemplateVariant = (title: string, issues: PromptBuildValidationIssue[]) =>
    [title, buildOpenUiRepairPrompt({
      attemptNumber: 1,
      committedSource: '{{committedSource}}',
      invalidSource: '{{invalidDraft}}',
      issues,
      maxRepairAttempts,
      promptMaxChars: REPAIR_PROMPT_TEMPLATE_MAX_CHARS,
      structuredOutput,
      userPrompt: '{{userPrompt}}',
    })].join('\n\n');

  return [
    buildTemplateVariant('Parser-only repair example', parserExampleIssues),
    buildTemplateVariant('Quality-only repair example', qualityExampleIssues),
    buildTemplateVariant('Mixed repair example', mixedExampleIssues),
  ].join('\n\n');
}
