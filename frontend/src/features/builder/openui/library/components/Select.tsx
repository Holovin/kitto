import { useId, useState } from 'react';
import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Select as SelectUI, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { z } from 'zod';
import {
  appearanceSchema,
  choiceOptionSchema,
  getValidationFeedback,
  getAppearanceStyle,
  nullableTextSchema,
  sanitizeValidationRules,
  useKittoAppearanceScope,
  useKittoValidationInteraction,
  validationRulesSchema,
  type ValidationRuleConfig,
} from './shared';

type SelectRendererProps = ComponentRenderProps<{
  appearance?: { contrastColor?: string; mainColor?: string };
  helper?: string | null;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  validation?: ValidationRuleConfig[];
  value: StateField<string | undefined>;
}>;

function OpenUiSelectRenderer({ props }: SelectRendererProps) {
  const feedbackId = useId();
  const [touched, setTouched] = useState(false);
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const { submitLikeInteractionCount } = useKittoValidationInteraction();
  const validationTarget = { componentType: 'Select' as const };
  const validationRules = sanitizeValidationRules(validationTarget, props.validation);
  const { hasVisibleError, helperText } = getValidationFeedback({
    helper: props.helper,
    rules: validationRules,
    submitLikeInteractionCount,
    target: validationTarget,
    touched,
    value: field.value ?? '',
  });
  const appearanceScope = useKittoAppearanceScope();
  const labelStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });
  const selectStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });
  const itemStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
  });

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={labelStyle}>
        {props.label}
      </span>
      <SelectUI
        disabled={isStreaming}
        name={props.name}
        value={field.value ?? ''}
        onValueChange={(nextValue: string) => {
          setTouched(true);
          field.setValue(nextValue);
        }}
      >
        <SelectTrigger
          aria-describedby={helperText ? feedbackId : undefined}
          aria-invalid={hasVisibleError}
          aria-label={props.label}
          className={hasVisibleError ? 'border-rose-400 focus-visible:border-rose-500' : undefined}
          style={selectStyle}
          onBlur={() => setTouched(true)}
        >
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent portalled={false} style={selectStyle}>
          {props.options.map((option) => (
            <SelectItem key={option.value} style={itemStyle} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectUI>
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
    </div>
  );
}

export const SelectComponent = defineComponent({
  name: 'Select',
  description: 'Dropdown selector with optional helper text and declarative validation for choosing one item from a short list of label/value pairs.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the select field.'),
    value: reactive(z.string().optional().describe('Currently selected value, often bound to a $variable.')),
    options: z.array(choiceOptionSchema).default([]).describe('Option list with label/value pairs.'),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    validation: validationRulesSchema,
    appearance: appearanceSchema,
  }),
  component: OpenUiSelectRenderer,
});
