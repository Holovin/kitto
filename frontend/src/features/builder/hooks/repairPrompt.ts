import type { BuilderParseIssue } from '@features/builder/types';

export const MAX_AUTO_REPAIR_ATTEMPTS = 1;

type RepairIssueMode = 'mixed' | 'parser' | 'quality';

const REPAIR_CRITICAL_RULES = [
  'Return only raw OpenUI Lang.',
  'Return the full updated program.',
  'Use only supported components and tools.',
  'Every @Run(ref) must reference a defined Query or Mutation.',
  'AppShell signature is AppShell(children, appearance?).',
  'Screen signature is Screen(id, title, children, isActive?, appearance?).',
  'Group signature is Group(title, direction, children, variant?, appearance?).',
  'The second Group argument is direction and must be "vertical" or "horizontal".',
  'If you pass a Group variant, place it in the optional fourth argument.',
  'Never put "block" or "inline" in the second Group argument.',
  'Use appearance only as { mainColor?: "#RRGGBB", contrastColor?: "#RRGGBB" }.',
  'Text supports only appearance.contrastColor. Do not pass appearance.mainColor to Text.',
  'For Button default, contrastColor becomes the button background and mainColor becomes the button text.',
  'Never use CSS, className, style objects, named colors, rgb(), hsl(), var(), url(), or arbitrary layout styling.',
  'Use $currentScreen + @Set for screen navigation.',
  'Button signature is Button(id, label, variant, action?, disabled?, appearance?).',
] as const;

function formatValidationIssue(issue: BuilderParseIssue) {
  return `${issue.code}${issue.statementId ? ` in ${issue.statementId}` : ''}: ${issue.message}`;
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

function buildRepairSourceSectionContent(value: string, maxChars: number, fallback: string) {
  if (maxChars <= 0) {
    return fallback;
  }

  return value.trim() ? truncateText(value, maxChars) : fallback;
}

function allocateRepairSectionBudgets(totalChars: number) {
  const sectionKeys = ['userPrompt', 'committedSource', 'invalidSource', 'issues'] as const;
  const minimumBudgets = {
    userPrompt: 120,
    committedSource: 180,
    invalidSource: 300,
    issues: 200,
  } as const;
  const weights = {
    userPrompt: 1,
    committedSource: 1.2,
    invalidSource: 2.8,
    issues: 1.6,
  } as const;
  const budgets = {
    userPrompt: 0,
    committedSource: 0,
    invalidSource: 0,
    issues: 0,
  };

  if (totalChars <= 0) {
    return budgets;
  }

  const minimumTotal = sectionKeys.reduce((sum, key) => sum + minimumBudgets[key], 0);
  const totalWeight = sectionKeys.reduce((sum, key) => sum + weights[key], 0);

  if (totalChars <= minimumTotal) {
    let allocated = 0;

    for (const key of sectionKeys) {
      const nextBudget = Math.floor((totalChars * weights[key]) / totalWeight);
      budgets[key] = nextBudget;
      allocated += nextBudget;
    }

    let remainder = totalChars - allocated;

    for (const key of ['invalidSource', 'issues', 'committedSource', 'userPrompt'] as const) {
      if (remainder <= 0) {
        break;
      }

      budgets[key] += 1;
      remainder -= 1;
    }

    return budgets;
  }

  let allocated = minimumTotal;

  for (const key of sectionKeys) {
    budgets[key] = minimumBudgets[key];
  }

  const remainingChars = totalChars - minimumTotal;

  for (const key of sectionKeys) {
    const extraBudget = Math.floor((remainingChars * weights[key]) / totalWeight);
    budgets[key] += extraBudget;
    allocated += extraBudget;
  }

  let remainder = totalChars - allocated;

  for (const key of ['invalidSource', 'issues', 'committedSource', 'userPrompt'] as const) {
    if (remainder <= 0) {
      break;
    }

    budgets[key] += 1;
    remainder -= 1;
  }

  return budgets;
}

function buildRepairIssueSection(issues: BuilderParseIssue[], maxChars: number) {
  if (maxChars <= 0) {
    return '- Validation issues were detected, but they could not be enumerated in full.';
  }

  const selectedIssueLines: string[] = [];

  for (const issue of issues) {
    const nextLine = `- ${formatValidationIssue(issue)}`;
    const candidateSection = [...selectedIssueLines, nextLine].join('\n');

    if (candidateSection.length > maxChars) {
      break;
    }

    selectedIssueLines.push(nextLine);
  }

  if (!selectedIssueLines.length && issues[0]) {
    selectedIssueLines.push(`- ${truncateText(formatValidationIssue(issues[0]), Math.max(1, maxChars - 2))}`);
  }

  return selectedIssueLines.length ? selectedIssueLines.join('\n') : '- Validation issues were detected, but they could not be enumerated in full.';
}

function buildRepairHints(issues: BuilderParseIssue[]) {
  const hints = new Set<string>();

  for (const issue of issues) {
    if (issue.code === 'invalid-prop') {
      hints.add('Check component argument order against the documented signature before returning.');

      if (issue.message.includes('Group.direction')) {
        hints.add('For Group(...), the second argument is direction and must be "vertical" or "horizontal".');
        hints.add('If you need Group variant "block" or "inline", place it in the optional fourth argument.');
        hints.add('Never put "block" or "inline" in the second Group argument.');
      }

      if (issue.message.includes('Group.variant')) {
        hints.add('Group variant accepts only "block" or "inline" and belongs in the optional fourth argument.');
      }

      if (issue.message.includes('.appearance.') || issue.message.includes('.color') || issue.message.includes('.background')) {
        hints.add('Use appearance.mainColor and appearance.contrastColor only as six-character #RRGGBB hex strings such as "#111827" or "#F9FAFB".');
        hints.add('Use appearance only with mainColor and contrastColor keys. Do not use textColor, bgColor, or color/background prop names.');
        hints.add('Do not use named colors, rgb(), hsl(), var(), url(), CSS objects, or className/style props.');
        hints.add('For Button default, contrastColor becomes the button background and mainColor becomes the button text.');
      }

      if (
        issue.message.includes('Text.appearance.mainColor') ||
        issue.message.includes('Text.appearance.textColor') ||
        issue.message.includes('Text.appearance.bgColor') ||
        issue.message.includes('Text.background')
      ) {
        hints.add(
          'Text supports only appearance.contrastColor. If you need a colored surface, use Group, Screen, Repeater, or the control component appearance instead.',
        );
      }

      if (issue.message.includes('Screen.appearance') || issue.message.includes('Screen.color') || issue.message.includes('Screen.background')) {
        hints.add('Screen appearance belongs in the optional fifth argument: Screen(id, title, children, isActive?, appearance?).');
      }

      continue;
    }

    if (issue.code === 'quality-stale-persisted-query') {
      const referencedRuns = [...issue.message.matchAll(/@Run\(([^)]+)\)/g)].map((match) => match[1]);
      const suggestedQueryRuns = referencedRuns.filter((statementId) => statementId !== issue.statementId);

      if (issue.statementId && suggestedQueryRuns.length > 0) {
        hints.add(
          `The mutation updates persisted state used by visible UI, but the action does not re-run the query that reads it. Add ${suggestedQueryRuns
            .map((statementId) => `@Run(${statementId})`)
            .join(' or ')} later in the same Action after @Run(${issue.statementId}).`,
        );
      } else {
        hints.add('If a mutation updates persisted state that visible UI reads, re-run a matching Query("read_state", ...) later in the same Action.');
      }

      hints.add(
        'A matching persisted query can read the same path, a parent path, or a child path of the mutation path. Other steps such as @Reset(...) or @Set(...) may stay in the Action.',
      );
      continue;
    }

    if (issue.code === 'quality-missing-todo-controls') {
      hints.add(
        'For a todo request, include an input for the draft value, a persisted `Query("read_state", ...)`, an `append_state` mutation, a button action that runs the mutation and then the query, and a repeated list rendered through `@Each(...)` + `Repeater(...)`.',
      );
      continue;
    }

    if (issue.code === 'quality-random-result-not-visible') {
      hints.add(
        'For button-triggered randomness, use the canonical persisted recipe: `Mutation("write_computed_state", { op: "random_int", ... })`, `Query("read_state", { path: "..." }, defaultValue)`, and a button `Action(...)` that runs both in order.',
      );
      continue;
    }

    if (issue.code === 'quality-theme-state-not-applied') {
      hints.add(
        'When the user asks for theme switching, bind `appearance` on `AppShell` or another top-level container to a theme state such as `$currentTheme` so changing the state actually changes colors.',
      );
    }
  }

  return [...hints];
}

function getRepairIssueMode(issues: BuilderParseIssue[]): RepairIssueMode {
  const hasQualityIssues = issues.some((issue) => issue.source === 'quality');
  const hasNonQualityIssues = issues.some((issue) => issue.source !== 'quality');

  if (hasQualityIssues && hasNonQualityIssues) {
    return 'mixed';
  }

  return hasQualityIssues ? 'quality' : 'parser';
}

function buildRepairIntroSection(mode: RepairIssueMode, attemptNumber: number) {
  const introLines = [`The previous OpenUI draft cannot be committed yet. Automatic repair attempt ${attemptNumber} of ${MAX_AUTO_REPAIR_ATTEMPTS}.`];

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

export function buildRepairPrompt(args: {
  userPrompt: string;
  committedSource: string;
  invalidSource: string;
  issues: BuilderParseIssue[];
  attemptNumber: number;
  promptMaxChars: number;
}) {
  const { attemptNumber, committedSource, invalidSource, issues, promptMaxChars, userPrompt } = args;
  const issueMode = getRepairIssueMode(issues);
  const repairHints = buildRepairHints(issues);
  const introSection = buildRepairIntroSection(issueMode, attemptNumber);
  const draftSectionTitle = getRepairDraftSectionTitle(issueMode);
  const draftSectionFallback = getRepairDraftSectionFallback(issueMode);
  const issuesSectionTitle = getRepairIssuesSectionTitle(issueMode);
  const rulesSection = REPAIR_CRITICAL_RULES.map((rule) => `- ${rule}`).join('\n');
  const hintsSection = repairHints.map((hint) => `- ${hint}`).join('\n');
  const sectionHeaders = [
    'Original user request:',
    'Current committed valid OpenUI source:',
    `${draftSectionTitle}:`,
    `${issuesSectionTitle}:`,
    ...(repairHints.length > 0 ? ['Targeted repair hints:'] : []),
    'Current critical syntax rules:',
  ];
  const fixedChars =
    introSection.length +
    rulesSection.length +
    hintsSection.length +
    sectionHeaders.reduce((sum, header) => sum + header.length + 1, 0) +
    10;
  const budgets = allocateRepairSectionBudgets(promptMaxChars - fixedChars);

  return truncateText(
    [
      introSection,
      buildRepairSection('Original user request', buildRepairSourceSectionContent(userPrompt, budgets.userPrompt, '(empty user request)')),
      buildRepairSection(
        'Current committed valid OpenUI source',
        buildRepairSourceSectionContent(committedSource, budgets.committedSource, '(blank canvas, no committed OpenUI source yet)'),
      ),
      buildRepairSection(draftSectionTitle, buildRepairSourceSectionContent(invalidSource, budgets.invalidSource, draftSectionFallback)),
      buildRepairSection(issuesSectionTitle, buildRepairIssueSection(issues, budgets.issues)),
      repairHints.length > 0 ? buildRepairSection('Targeted repair hints', hintsSection) : null,
      buildRepairSection('Current critical syntax rules', rulesSection),
    ]
      .filter(Boolean)
      .join('\n\n'),
    promptMaxChars,
  );
}
