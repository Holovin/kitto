import type { BuilderParseIssue } from '@features/builder/types';

export const MAX_AUTO_REPAIR_ATTEMPTS = 1;

const REPAIR_CRITICAL_RULES = [
  'Return only raw OpenUI Lang.',
  'Return the full updated program.',
  'Use only supported components and tools.',
  'Every @Run(ref) must reference a defined Query or Mutation.',
  'Screen signature is Screen(id, title, children, isActive?).',
  'Group signature is Group(title, direction, children, variant?).',
  'The second Group argument is direction and must be "vertical" or "horizontal".',
  'If you pass a Group variant, place it in the optional fourth argument.',
  'Never put "block" or "inline" in the second Group argument.',
  'Use $currentScreen + @Set for screen navigation.',
  'Button signature is Button(id, label, variant, action?, disabled?).',
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
    if (issue.code !== 'invalid-prop') {
      continue;
    }

    hints.add('Check component argument order against the documented signature before returning.');

    if (issue.message.includes('Group.direction')) {
      hints.add('For Group(...), the second argument is direction and must be "vertical" or "horizontal".');
      hints.add('If you need Group variant "block" or "inline", place it in the optional fourth argument.');
      hints.add('Never put "block" or "inline" in the second Group argument.');
    }

    if (issue.message.includes('Group.variant')) {
      hints.add('Group variant accepts only "block" or "inline" and belongs in the optional fourth argument.');
    }
  }

  return [...hints];
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
  const repairHints = buildRepairHints(issues);
  const introSection = [
    `The previous OpenUI draft is invalid. Automatic repair attempt ${attemptNumber} of ${MAX_AUTO_REPAIR_ATTEMPTS}.`,
    'Use the current committed valid OpenUI source as the baseline for this request.',
    'Carry forward the intended changes from the invalid model draft only when they can be expressed as valid OpenUI.',
    'Fix every validation issue below and return a complete corrected program.',
  ].join('\n');
  const rulesSection = REPAIR_CRITICAL_RULES.map((rule) => `- ${rule}`).join('\n');
  const hintsSection = repairHints.map((hint) => `- ${hint}`).join('\n');
  const sectionHeaders = [
    'Original user request:',
    'Current committed valid OpenUI source:',
    'Invalid model draft:',
    'Validation issues:',
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
      buildRepairSection('Invalid model draft', buildRepairSourceSectionContent(invalidSource, budgets.invalidSource, '(the invalid draft was empty)')),
      buildRepairSection('Validation issues', buildRepairIssueSection(issues, budgets.issues)),
      repairHints.length > 0 ? buildRepairSection('Targeted repair hints', hintsSection) : null,
      buildRepairSection('Current critical syntax rules', rulesSection),
    ]
      .filter(Boolean)
      .join('\n\n'),
    promptMaxChars,
  );
}
