import { useId, useState } from 'react';
import {
  defineComponent,
  reactive,
  useIsStreaming,
  useSetFieldValue,
  useStateField,
  type ComponentRenderProps,
  type StateField,
} from '@openuidev/react-lang';
import { RadioGroup as RadioGroupUI, RadioGroupItem } from '@components/ui/radio-group';
import { z } from 'zod';
import {
  ACTION_MODE_LAST_CHOICE_STATE,
  appearanceSchema,
  choiceOptionSchema,
  getValidationFeedback,
  getAppearanceStyle,
  nullableTextSchema,
  sanitizeValidationRules,
  useKittoAppearanceScope,
  useRegisterKittoValidationField,
  useKittoValidationInteraction,
  validationRulesSchema,
  type ValidationRuleConfig,
} from './shared';
import { useActionModeControl } from './useActionModeControl';

type RadioGroupRendererProps = ComponentRenderProps<{
  action?: unknown;
  appearance?: { contrastColor?: string; mainColor?: string };
  helper?: string | null;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  validation?: ValidationRuleConfig[];
  value: StateField<string | undefined> | string | undefined;
}>;

function OpenUiRadioGroupRenderer({ props }: RadioGroupRendererProps) {
  const feedbackId = useId();
  const [touched, setTouched] = useState(false);
  const isStreaming = useIsStreaming();
  const setFieldValue = useSetFieldValue();
  const field = useStateField(props.name, props.value);
  const { isActionMode, isPending, runAction } = useActionModeControl({
    action: props.action,
    beforeRun: (nextValue: string) => {
      setFieldValue(undefined, undefined, ACTION_MODE_LAST_CHOICE_STATE, nextValue, false);
    },
    name: props.name || 'radio-group',
    queue: 'choice',
  });
  const { interactedNames } = useKittoValidationInteraction();
  useRegisterKittoValidationField(props.name);
  const validationTarget = { componentType: 'RadioGroup' as const };
  const validationRules = sanitizeValidationRules(validationTarget, props.validation);
  const selectedValue = isActionMode ? (typeof props.value === 'string' ? props.value : '') : (field.value ?? '');
  const validationFeedback = isActionMode
    ? {
        hasVisibleError: false,
        helperText: props.helper ?? undefined,
      }
    : getValidationFeedback({
        helper: props.helper,
        interactedNames,
        name: props.name,
        rules: validationRules,
        target: validationTarget,
        touched,
        value: selectedValue,
      });
  const { hasVisibleError, helperText } = validationFeedback;
  const appearanceScope = useKittoAppearanceScope();
  const labelStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });
  const optionStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={labelStyle}>
        {props.label}
      </span>
      <RadioGroupUI
        aria-describedby={helperText ? feedbackId : undefined}
        aria-invalid={hasVisibleError}
        disabled={isActionMode ? isStreaming || isPending : isStreaming}
        value={selectedValue}
        onBlur={isActionMode ? undefined : () => setTouched(true)}
        onValueChange={(nextValue: string) => {
          if (isActionMode) {
            void runAction(nextValue);
            return;
          }

          setTouched(true);
          field.setValue(nextValue);
        }}
      >
        {props.options.map((option) => (
          <label
            key={option.value}
            className={`flex items-center gap-3 rounded-[1.25rem] border bg-white px-4 py-3 text-sm text-slate-800 ${
              hasVisibleError ? 'border-rose-300' : 'border-slate-200'
            }`}
            style={optionStyle}
          >
            <RadioGroupItem className={hasVisibleError ? 'border-rose-400 focus-visible:border-rose-500' : undefined} style={optionStyle} value={option.value} />
            <span>{option.label}</span>
          </label>
        ))}
      </RadioGroupUI>
      {helperText ? (
        <p className="text-sm leading-6 text-slate-500" id={feedbackId}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export const RadioGroupComponent = defineComponent({
  name: 'RadioGroup',
  description:
    'Single-choice list of options with optional helper text and declarative validation. Use a $binding<string> for form state, or a display-only string plus action for persisted choice updates. In action mode, the runtime writes the new option to `$lastChoice` before Action([...]) runs.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the option set.'),
    value: reactive(
      z
        .string()
        .optional()
        .describe('Writable $binding<string> for form state, or a display-only string when action mode runs an explicit Action([...]).'),
    ),
    options: z.array(choiceOptionSchema).default([]).describe('Option list with label/value pairs.'),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    validation: validationRulesSchema,
    action: z
      .unknown()
      .optional()
      .describe('Optional Action([...]) for persisted choice updates. Action mode writes the selected option to `$lastChoice` before the action runs.'),
    appearance: appearanceSchema,
  }),
  component: OpenUiRadioGroupRenderer,
});
