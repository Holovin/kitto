import { useId, useRef, useState } from 'react';
import { defineComponent, reactive, useIsStreaming, useStateField, useTriggerAction, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Checkbox as CheckboxUI } from '@components/ui/checkbox';
import { z } from 'zod';
import {
  appearanceSchema,
  getValidationFeedback,
  getAppearanceStyle,
  nullableTextSchema,
  sanitizeValidationRules,
  useKittoAppearanceScope,
  useKittoValidationInteraction,
  validationRulesSchema,
  type ValidationRuleConfig,
} from './shared';

type CheckboxRendererProps = ComponentRenderProps<{
  action?: unknown;
  appearance?: { contrastColor?: string; mainColor?: string };
  checked?: StateField<boolean> | boolean;
  helper?: string | null;
  label: string;
  name: string;
  validation?: ValidationRuleConfig[];
}>;

let checkboxActionQueue: Promise<void> = Promise.resolve();

function enqueueCheckboxAction(runAction: () => Promise<void>) {
  const nextAction = checkboxActionQueue.then(runAction, runAction);
  checkboxActionQueue = nextAction.catch(() => undefined);
  return nextAction;
}

function OpenUiCheckboxRenderer({ props }: CheckboxRendererProps) {
  const feedbackId = useId();
  const [touched, setTouched] = useState(false);
  const [isPending, setPending] = useState(false);
  const pendingActionRef = useRef(false);
  const isStreaming = useIsStreaming();
  const triggerAction = useTriggerAction();
  const field = useStateField(props.name, props.checked);
  const isActionMode = props.action != null;
  const { submitLikeInteractionCount } = useKittoValidationInteraction();
  const hasLabel = props.label.trim().length > 0;
  const validationTarget = { componentType: 'Checkbox' as const };
  const validationRules = sanitizeValidationRules(validationTarget, props.validation);
  const checkedValue = isActionMode ? Boolean(props.checked) : Boolean(field.value);
  const validationFeedback = isActionMode
    ? {
        hasVisibleError: false,
        helperText: props.helper ?? undefined,
      }
    : getValidationFeedback({
        helper: props.helper,
        rules: validationRules,
        submitLikeInteractionCount,
        target: validationTarget,
        touched,
        value: checkedValue,
      });
  const { hasVisibleError, helperText } = validationFeedback;
  const appearanceScope = useKittoAppearanceScope();
  const checkboxStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });
  const labelStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });

  async function handleActionToggle() {
    if (isStreaming || pendingActionRef.current) {
      return;
    }

    pendingActionRef.current = true;
    setPending(true);

    try {
      await enqueueCheckboxAction(async () => {
        await triggerAction(props.name || 'checkbox', undefined, props.action as never);
      });
    } finally {
      pendingActionRef.current = false;
      setPending(false);
    }
  }

  const checkboxControl = (
    <CheckboxUI
      aria-describedby={helperText ? feedbackId : undefined}
      aria-invalid={hasVisibleError}
      checked={checkedValue}
      className={hasVisibleError ? 'border-rose-400 focus-visible:border-rose-500' : undefined}
      disabled={isActionMode ? isStreaming || isPending : isStreaming}
      style={checkboxStyle}
      onBlur={isActionMode ? undefined : () => setTouched(true)}
      onCheckedChange={
        isActionMode
          ? () => {
              void handleActionToggle();
            }
          : (checked: boolean | 'indeterminate') => {
              setTouched(true);
              field.setValue(Boolean(checked));
            }
      }
    />
  );

  if (!hasLabel) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex h-5 items-center">{checkboxControl}</div>
        {helperText ? (
          <p className="text-sm leading-6 text-slate-500" id={feedbackId}>
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        className={`flex items-start gap-3 rounded-[1.25rem] border bg-white px-4 py-3 ${
          hasVisibleError ? 'border-rose-400' : 'border-slate-200'
        }`}
        style={checkboxStyle}
      >
        {checkboxControl}
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-slate-900" style={labelStyle}>
            {props.label}
          </span>
        </span>
      </label>
      {helperText ? (
        <p className="text-sm leading-6 text-slate-500" id={feedbackId}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export const CheckboxComponent = defineComponent({
  name: 'Checkbox',
  description:
    'Boolean toggle for either local form state or explicit action flows. Use a $binding<boolean> for form state, or a display-only boolean plus action for persisted row toggles. Required validation means the checkbox must be checked.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label shown next to the checkbox.'),
    checked: reactive(
      z
        .boolean()
        .optional()
        .describe('Writable $binding<boolean> for form state, or a display-only boolean when action mode runs an explicit Action([...]).'),
    ),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    validation: validationRulesSchema,
    action: z.unknown().optional().describe('Optional Action([...]) for persisted row toggles or other explicit checkbox-triggered flows.'),
    appearance: appearanceSchema,
  }),
  component: OpenUiCheckboxRenderer,
});
