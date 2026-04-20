import { useId, useState } from 'react';
import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Input as InputUI } from '@components/ui/input';
import { z } from 'zod';
import {
  appearanceSchema,
  getValidationFeedback,
  getAppearanceStyle,
  getInputAutoComplete,
  inputTypeSchema,
  nullableTextSchema,
  sanitizeValidationRules,
  useKittoAppearanceScope,
  useKittoValidationInteraction,
  validationRulesSchema,
  type InputType,
  type ValidationRuleConfig,
} from './shared';

type InputRendererProps = ComponentRenderProps<{
  appearance?: { contrastColor?: string; mainColor?: string };
  helper?: string | null;
  label: string;
  name: string;
  placeholder?: string | null;
  type: InputType;
  validation?: ValidationRuleConfig[];
  value: StateField<string | undefined>;
}>;

function OpenUiInputRenderer({ props }: InputRendererProps) {
  const feedbackId = useId();
  const [touched, setTouched] = useState(false);
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const { submitLikeInteractionCount } = useKittoValidationInteraction();
  const validationTarget = {
    componentType: 'Input' as const,
    inputType: props.type,
  };
  const validationRules = sanitizeValidationRules(validationTarget, props.validation);
  const { hasVisibleError, helperText } = getValidationFeedback({
    helper: props.helper,
    rules: validationRules,
    submitLikeInteractionCount,
    target: validationTarget,
    touched,
    value: field.value ?? '',
  });
  const autoComplete = getInputAutoComplete(props.name, props.type);
  const appearanceScope = useKittoAppearanceScope();
  const labelStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });
  const inputStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });

  return (
    <label className="flex flex-col gap-2" data-kitto-stacked-field="true">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={labelStyle}>
        {props.label}
      </span>
      <InputUI
        aria-describedby={helperText ? feedbackId : undefined}
        aria-invalid={hasVisibleError}
        autoComplete={autoComplete}
        className={hasVisibleError ? 'border-rose-400 focus-visible:border-rose-500' : undefined}
        disabled={isStreaming}
        name={props.name}
        placeholder={props.placeholder ?? undefined}
        style={inputStyle}
        type={props.type}
        value={field.value ?? ''}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          setTouched(true);
          field.setValue(event.target.value);
        }}
      />
      {helperText ? (
        <p
          aria-live={hasVisibleError ? 'polite' : undefined}
          className={hasVisibleError ? 'text-sm leading-6 text-rose-600' : 'text-sm leading-6 text-slate-500'}
          id={feedbackId}
          role={hasVisibleError ? 'alert' : undefined}
        >
          {helperText}
        </p>
      ) : null}
    </label>
  );
}

export const InputComponent = defineComponent({
  name: 'Input',
  description:
    'Single-line input with HTML type support, optional helper text, and declarative validation. Values always stay strings, including number, date, and time inputs.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the field.'),
    value: reactive(z.string().optional().describe('Current value, often bound to a $variable. Input values always stay strings.')),
    placeholder: nullableTextSchema.describe('Placeholder text shown when empty.'),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    type: inputTypeSchema,
    validation: validationRulesSchema,
    appearance: appearanceSchema,
  }),
  component: OpenUiInputRenderer,
});
