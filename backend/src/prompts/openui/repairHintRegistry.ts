import { getOpenUiComponentCompactSignature } from './componentSpec.js';
import { BUTTON_APPEARANCE_RULE } from './rules.js';
import type { PromptBuildValidationIssue } from './types.js';

export interface StalePersistedQueryContext {
  statementId: string;
  suggestedQueryRefs: string[];
}

export interface OptionsShapeContext {
  groupId: string;
  invalidValues: Array<number | string>;
}

interface RepairHintContext {
  hasChoiceActionModeLastChoice: boolean;
}

type RepairHintHandler = (issue: PromptBuildValidationIssue, context: RepairHintContext) => string[];

export const CONTROL_ACTION_AND_BINDING_REPAIR_HINT =
  'Repair hint: Pick one of: (a) keep `$binding` and remove `action`, OR (b) keep `action` and replace the writable `$binding<…>` with a display-only literal/`item.field`.';
export const CONTROL_ACTION_AND_BINDING_LAST_CHOICE_REPAIR_HINT =
  'If a RadioGroup/Select repair removes `action`, also remove or rewrite any top-level Mutation(...) / Query(...) helpers that still reference `$lastChoice`. Otherwise the repaired draft will still fail quality checks.';

function formatInvalidOptionValue(value: number | string) {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

export function getStalePersistedQueryIssueContext(issue: PromptBuildValidationIssue): StalePersistedQueryContext | null {
  if (issue.code !== 'quality-stale-persisted-query') {
    return null;
  }

  if (!issue.context || !('suggestedQueryRefs' in issue.context)) {
    return null;
  }

  return issue.context;
}

export function getOptionsShapeIssueContext(issue: PromptBuildValidationIssue): OptionsShapeContext | null {
  if (issue.code !== 'quality-options-shape') {
    return null;
  }

  if (!issue.context || !('invalidValues' in issue.context)) {
    return null;
  }

  return issue.context;
}

const REPAIR_HINT_HANDLERS: Record<string, RepairHintHandler> = {
  'app-shell-not-root': () => [
    'AppShell must be the single root statement; never nest AppShell and never define a second AppShell anywhere else in the source.',
  ],
  'control-action-and-binding': (_issue, context) =>
    context.hasChoiceActionModeLastChoice ? [CONTROL_ACTION_AND_BINDING_LAST_CHOICE_REPAIR_HINT] : [],
  'inline-tool-in-each': () => [
    'Mutation(...) and Query(...) must be top-level statements. Never inline them inside @Each(...), Repeater(...), component props, or other expressions.',
  ],
  'inline-tool-in-prop': () => [
    'Mutation(...) and Query(...) must be top-level statements. Never inline them inside @Each(...), Repeater(...), component props, or other expressions.',
  ],
  'inline-tool-in-repeater': () => [
    'Mutation(...) and Query(...) must be top-level statements. Never inline them inside @Each(...), Repeater(...), component props, or other expressions.',
  ],
  'invalid-prop': (issue) => {
    const hints = ['Check component argument order against the documented signature before returning.'];

    if (issue.message.includes('Group.direction')) {
      hints.push(
        'For Group(...), the second argument is direction and must be "vertical" or "horizontal".',
        'If you need Group variant "block" or "inline", place it in the optional fourth argument.',
        'Never put "block" or "inline" in the second Group argument.',
      );
    }

    if (issue.message.includes('Group.variant')) {
      hints.push('Group variant accepts only "block" or "inline" and belongs in the optional fourth argument.');
    }

    if (issue.message.includes('.appearance.') || issue.message.includes('.color') || issue.message.includes('.background')) {
      hints.push(
        'Use appearance.mainColor and appearance.contrastColor only as six-character #RRGGBB hex strings such as "#111827" or "#F9FAFB".',
        'Use appearance only with mainColor and contrastColor keys. Do not use textColor, bgColor, or color/background prop names.',
        'Do not use named colors, rgb(), hsl(), var(), url(), CSS objects, or className/style props.',
        BUTTON_APPEARANCE_RULE,
      );
    }

    if (
      issue.message.includes('Text.appearance.mainColor') ||
      issue.message.includes('Text.appearance.textColor') ||
      issue.message.includes('Text.appearance.bgColor') ||
      issue.message.includes('Text.background')
    ) {
      hints.push(
        'Text supports only appearance.contrastColor. If you need a colored surface, use Group, Screen, Repeater, or the control component appearance instead.',
      );
    }

    if (issue.message.includes('Screen.appearance') || issue.message.includes('Screen.color') || issue.message.includes('Screen.background')) {
      hints.push(`Screen appearance belongs in the optional fifth argument: ${getOpenUiComponentCompactSignature('Screen')}.`);
    }

    return hints;
  },
  'multiple-app-shells': () => [
    'AppShell must be the single root statement; never nest AppShell and never define a second AppShell anywhere else in the source.',
  ],
  'quality-missing-todo-controls': () => [
    'For a todo request, include an input for the draft value, a persisted `Query("read_state", ...)`, an `append_item` mutation for plain-object todo rows, a button action that runs the mutation and then the query, and a repeated list rendered through `@Each(...)` + `Repeater(...)`.',
  ],
  'quality-missing-control-showcase-components': () => [
    'For a control showcase, keep the app visible and include at least one Input, TextArea, Checkbox, RadioGroup, Select, Button, and Link.',
  ],
  'quality-missing-screen-flow': () => [
    'For a step-by-step flow, declare a local step variable, pass a matching boolean expression only to conditionally visible Screen sections, and navigate with button actions that call `@Set(...)`.',
    'Leave always-visible helper sections without isActive.',
  ],
  'quality-options-shape': (issue) => {
    const optionsShapeContext = getOptionsShapeIssueContext(issue);
    const hints = [];

    if (optionsShapeContext) {
      hints.push(
        `In \`${optionsShapeContext.groupId}\`, convert invalid option values ${optionsShapeContext.invalidValues
          .map(formatInvalidOptionValue)
          .join(', ')} into objects with both label and value.`,
      );
    }

    hints.push('Wrap each option in `{ label: "...", value: "..." }`.');
    return hints;
  },
  'quality-random-result-not-visible': () => [
    'For button-triggered randomness, use the canonical persisted recipe: `Mutation("write_computed_state", { op: "random_int", ... })`, `Query("read_state", { path: "..." }, defaultValue)`, and a button `Action(...)` that runs both in order.',
  ],
  'quality-stale-persisted-query': (issue) => {
    const staleQueryContext = getStalePersistedQueryIssueContext(issue);
    const mutationRunStatementId = staleQueryContext?.statementId ?? issue.statementId;
    const suggestedQueryRuns = staleQueryContext?.suggestedQueryRefs ?? [];
    const hints = [];

    if (mutationRunStatementId && suggestedQueryRuns.length > 0) {
      hints.push(
        `The mutation updates persisted state used by visible UI, but the action does not re-run the query that reads it. Add ${suggestedQueryRuns
          .map((statementId) => `@Run(${statementId})`)
          .join(' or ')} later in the same Action after @Run(${mutationRunStatementId}).`,
      );
    } else {
      hints.push(
        'If a mutation updates persisted state that visible UI reads, re-run a matching Query("read_state", ...) later in the same Action.',
      );
    }

    hints.push(
      'A matching persisted query can read the same path, a parent path, or a child path of the mutation path. Other steps such as @Reset(...) or @Set(...) may stay in the Action.',
    );
    return hints;
  },
  'quality-theme-state-not-applied': () => [
    'When the user asks to switch or toggle between themes, introduce a theme state such as `$currentTheme`, derive a theme object from it, and bind `appearance` on `AppShell` or another top-level container to that derived theme.',
  ],
  'repeater-inside-repeater': () => [
    'Repeater never contains another Repeater at any depth. Flatten nested list ideas or use Group inside the row template instead of nesting Repeaters.',
  ],
  'screen-inside-screen': () => [
    'Screen never contains another Screen at any depth. Keep Screens as top-level AppShell children and use Group for local layout inside a screen.',
  ],
  'unsafe-url-literal': () => [
    'Use only full absolute URL literals for Link(...) and @OpenUrl(...): https://... or http://....',
    'Never use javascript:, data:, file:, blob:, mailto:, tel:, protocol-relative // URLs, relative paths, hash anchors, whitespace-padded URLs, or URLs containing spaces.',
  ],
};

export function getRepairHintsForIssue(issue: PromptBuildValidationIssue, context: RepairHintContext) {
  return REPAIR_HINT_HANDLERS[issue.code]?.(issue, context) ?? [];
}
