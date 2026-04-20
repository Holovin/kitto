import { useId, useState } from 'react';
import { defineComponent, reactive, useIsStreaming, useStateField, type ComponentRenderProps, type StateField } from '@openuidev/react-lang';
import { Textarea as TextareaUI } from '@components/ui/textarea';
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

type TextAreaRendererProps = ComponentRenderProps<{
  appearance?: { contrastColor?: string; mainColor?: string };
  helper?: string | null;
  label: string;
  name: string;
  placeholder?: string | null;
  validation?: ValidationRuleConfig[];
  value: StateField<string | undefined>;
}>;

function OpenUiTextAreaRenderer({ props }: TextAreaRendererProps) {
  const feedbackId = useId();
  const [touched, setTouched] = useState(false);
  const isStreaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const { submitLikeInteractionCount } = useKittoValidationInteraction();
  const validationTarget = { componentType: 'TextArea' as const };
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
  const textAreaStyle = getAppearanceStyle({
    appearance: props.appearance,
    textRole: 'contrast',
    backgroundRole: 'main',
    hasInheritedContrastColor: appearanceScope.hasContrastColor,
    hasInheritedMainColor: appearanceScope.hasMainColor,
  });

  return (
    <label className="flex flex-col gap-2">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-slate-600" style={labelStyle}>
        {props.label}
      </span>
      <TextareaUI
        aria-describedby={helperText ? feedbackId : undefined}
        aria-invalid={hasVisibleError}
        className={hasVisibleError ? 'border-rose-400 focus-visible:border-rose-500' : undefined}
        disabled={isStreaming}
        name={props.name}
        placeholder={props.placeholder ?? undefined}
        style={textAreaStyle}
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

export const TextAreaComponent = defineComponent({
  name: 'TextArea',
  description: 'Multi-line text input with optional helper text and declarative validation for longer descriptions, prompts, or notes.',
  props: z.object({
    name: z.string().describe('Stable field name used for persistence and bindings.'),
    label: z.string().describe('Visible label for the field.'),
    value: reactive(z.string().optional().describe('Current value, often bound to a $variable.')),
    placeholder: nullableTextSchema.describe('Placeholder text shown when empty.'),
    helper: nullableTextSchema.describe('Optional helper text shown below the control when there is no validation error.'),
    validation: validationRulesSchema,
    appearance: appearanceSchema,
  }),
  component: OpenUiTextAreaRenderer,
});
