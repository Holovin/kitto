import { useId, useState } from 'react';
import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { RadioGroup as RadioGroupUI, RadioGroupItem } from '@components/ui/radio-group';
import { z } from 'zod';
import {
  appearanceSchema,
  choiceOptionSchema,
  evaluateValidationRules,
  getAppearanceStyle,
  nullableTextSchema,
  sanitizeValidationRules,
  useKittoAppearanceScope,
  validationRulesSchema,
  type ValidationRuleConfig,
} from './shared';

type RadioGroupRendererProps = ComponentRenderProps<{
  appearance?: { contrastColor?: string; mainColor?: string };
  helper?: string | null;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  validation?: ValidationRuleConfig[];
  value: StateField<string | undefined>;
}>;

function OpenUiRadioGroupRenderer({ props }: RadioGroupRendererProps) {
  const feedbackId = useId();
  const [touched, setTouched] = useState(false);
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const validationTarget = { componentType: 'RadioGroup' as const };
  const validationRules = sanitizeValidationRules(validationTarget, props.validation);
  const validationError = touched
    ? evaluateValidationRules({
        rules: validationRules,
        target: validationTarget,
        value: field.value ?? '',
      })
    : undefined;
  const hasVisibleError = validationError !== undefined;
  const helperText =
    validationError ?? (typeof props.helper === 'string' && props.helper.trim().length > 0 ? props.helper : undefined);
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
        disabled={isStreaming}
        value={field.value ?? ''}
        onBlur={() => setTouched(true)}
        onValueChange={(nextValue: string) => {
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
        <p
          className={hasVisibleError ? 'text-sm leading-6 text-rose-600' : 'text-sm leading-6 text-slate-500'}
          id={feedbackId}
        >
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export const RadioGroupComponent = defineComponent({
  name: 'RadioGroup',
  description: 'Single-choice list of options with optional helper text and declarative validation. Good for quizzes, steps, and mode switches.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the option set.'),
    value: reactive(z.string().optional().describe('Currently selected option value, often bound to a $variable.')),
    options: z.array(choiceOptionSchema).default([]).describe('Option list with label/value pairs.'),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    validation: validationRulesSchema,
    appearance: appearanceSchema,
  }),
  component: OpenUiRadioGroupRenderer,
});
